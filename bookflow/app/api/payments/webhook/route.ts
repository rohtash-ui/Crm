import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/paypal";
import { createCalendarEvent } from "@/lib/google-calendar";
import { sendBookingConfirmation, sendHostNotification } from "@/lib/email";
import { isGoogleCalendarConfigured } from "@/lib/env";

export async function POST(request: Request) {
  const body = await request.text();
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;

  if (!webhookId) {
    console.warn("[Webhook] PAYPAL_WEBHOOK_ID not set — skipping signature verification");
  }

  // Build header map (lowercase keys for consistent lookup)
  const rawHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    rawHeaders[key.toLowerCase()] = value;
  });

  // Verify signature when webhook ID is configured
  if (webhookId) {
    const isValid = await verifyWebhookSignature(body, rawHeaders, webhookId);
    if (!isValid) {
      return new Response("Invalid webhook signature", { status: 401 });
    }
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const eventType: string = event.event_type;
  const resource = event.resource;

  try {
    switch (eventType) {
      case "PAYMENT.CAPTURE.COMPLETED": {
        const captureId = resource.id;
        const orderId = resource.supplementary_data?.related_ids?.order_id;

        if (!orderId && !captureId) break;

        const payment = await prisma.payment.findFirst({
          where: {
            OR: [
              orderId ? { paypalOrderId: orderId } : {},
              captureId ? { paypalCaptureId: captureId } : {},
            ].filter((o) => Object.keys(o).length > 0),
          },
          include: {
            booking: {
              include: {
                eventType: true,
                host: {
                  include: {
                    calendarConnections: true,
                    accounts: { where: { provider: "google" } },
                  },
                },
              },
            },
          },
        });

        if (!payment) break;

        // Idempotent: already processed
        if (payment.status === "COMPLETED" && payment.webhookVerified) break;

        await prisma.$transaction([
          prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: "COMPLETED",
              paypalCaptureId: captureId || payment.paypalCaptureId,
              paypalPayerEmail: resource.payer?.email_address || payment.paypalPayerEmail,
              webhookVerified: true,
            },
          }),
          prisma.booking.update({
            where: { id: payment.bookingId },
            data: { status: "CONFIRMED" },
          }),
        ]);

        // Only create calendar event if booking wasn't already confirmed by capture
        const booking = payment.booking;
        if (booking.calendarEventId) break;

        const calConn = booking.host.calendarConnections[0];
        const googleAccount = booking.host.accounts[0];
        let meetLink: string | undefined;

        if (isGoogleCalendarConfigured() && calConn && googleAccount?.access_token) {
          try {
            const calEvent = await createCalendarEvent(
              googleAccount.access_token,
              googleAccount.refresh_token || calConn.refreshToken || "",
              {
                summary: `${booking.eventType.title} with ${booking.guestName}`,
                description: booking.notes || undefined,
                startTime: booking.startTime,
                endTime: booking.endTime,
                attendeeEmail: booking.guestEmail,
                attendeeName: booking.guestName,
                timezone: booking.host.timezone || "UTC",
              }
            );
            meetLink = calEvent.hangoutLink || undefined;
            await prisma.booking.update({
              where: { id: booking.id },
              data: { calendarEventId: calEvent.id || null },
            });
          } catch (err) {
            console.error("[Webhook] Calendar event creation failed:", err);
          }
        }

        await Promise.allSettled([
          sendBookingConfirmation({
            guestEmail: booking.guestEmail,
            guestName: booking.guestName,
            hostName: booking.host.name || "Host",
            eventTitle: booking.eventType.title,
            startTime: booking.startTime,
            endTime: booking.endTime,
            location: booking.eventType.location || undefined,
            meetLink,
            amount: payment.amount,
            currency: payment.currency,
          }),
          sendHostNotification({
            hostEmail: booking.host.email!,
            hostName: booking.host.name || "Host",
            guestName: booking.guestName,
            guestEmail: booking.guestEmail,
            guestPhone: booking.guestPhone || undefined,
            eventTitle: booking.eventType.title,
            startTime: booking.startTime,
            endTime: booking.endTime,
            amount: payment.amount,
            currency: payment.currency,
          }),
        ]);

        break;
      }

      case "PAYMENT.CAPTURE.DENIED": {
        const captureId = resource.id;
        const orderId = resource.supplementary_data?.related_ids?.order_id;

        const payment = await prisma.payment.findFirst({
          where: {
            OR: [
              orderId ? { paypalOrderId: orderId } : {},
              captureId ? { paypalCaptureId: captureId } : {},
            ].filter((o) => Object.keys(o).length > 0),
          },
        });

        if (payment && payment.status !== "COMPLETED") {
          await prisma.$transaction([
            prisma.payment.update({
              where: { id: payment.id },
              data: { status: "DENIED", webhookVerified: true },
            }),
            prisma.booking.update({
              where: { id: payment.bookingId },
              data: { status: "CANCELLED" },
            }),
          ]);
        }
        break;
      }

      case "CHECKOUT.ORDER.APPROVED": {
        // Order approved but not yet captured — no action needed,
        // capture will happen via the client-side flow.
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("[Webhook] Error processing event:", eventType, err);
    // Return 200 to prevent PayPal from retrying; log the error internally
  }

  return Response.json({ received: true });
}
