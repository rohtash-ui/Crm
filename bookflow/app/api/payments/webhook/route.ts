import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/paypal";
import { createCalendarEvent } from "@/lib/google-calendar";
import { sendBookingConfirmation, sendHostNotification } from "@/lib/email";
import { isGoogleCalendarConfigured } from "@/lib/env";

export async function POST(request: Request) {
  const body = await request.text();
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;

  // Build lowercase header map for consistent lookup
  const rawHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => { rawHeaders[key.toLowerCase()] = value; });

  // Verify signature when Webhook ID is configured
  if (webhookId) {
    const isValid = await verifyWebhookSignature(body, rawHeaders, webhookId);
    if (!isValid) {
      console.warn("[Webhook] PayPal signature verification failed");
      return new Response("Invalid webhook signature", { status: 401 });
    }
  } else {
    console.warn("[Webhook] PAYPAL_WEBHOOK_ID not set — skipping signature verification");
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const eventType: string = event.event_type;
  const resource        = event.resource;

  try {
    if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
      await handleCaptureCompleted(resource);
    } else if (eventType === "PAYMENT.CAPTURE.DENIED") {
      await handleCaptureDenied(resource);
    }
    // CHECKOUT.ORDER.APPROVED: order approved but not yet captured — no action needed
  } catch (err) {
    // Return 200 to stop PayPal retrying; the error is logged for investigation
    console.error("[Webhook] Error processing event:", eventType, err);
  }

  return Response.json({ received: true });
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleCaptureCompleted(resource: any) {
  const captureId = resource.id as string | undefined;
  const orderId   = resource.supplementary_data?.related_ids?.order_id as string | undefined;

  if (!captureId && !orderId) return;

  const payment = await prisma.payment.findFirst({
    where: {
      OR: [
        ...(orderId   ? [{ paypalOrderId:   orderId   }] : []),
        ...(captureId ? [{ paypalCaptureId: captureId }] : []),
      ],
    },
    include: {
      booking: {
        include: {
          eventType: true,
          host:      true,
        },
      },
    },
  });

  if (!payment) return;

  // Idempotent: already processed by the capture route
  if (payment.status === "COMPLETED" && payment.webhookVerified) return;

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        status:          "COMPLETED",
        paypalCaptureId: captureId ?? payment.paypalCaptureId,
        paypalPayerEmail:
          resource.payer?.email_address ?? payment.paypalPayerEmail,
        webhookVerified: true,
      },
    }),
    prisma.booking.update({
      where: { id: payment.bookingId },
      data:  { status: "CONFIRMED" },
    }),
  ]);

  const booking = payment.booking;

  // Only create calendar event if capture route didn't already do it
  if (booking.calendarEventId) return;

  let meetLink: string | null = null;

  if (isGoogleCalendarConfigured()) {
    try {
      const calEvent = await createCalendarEvent(booking.hostId, {
        summary:    `${booking.eventType.title} with ${booking.guestName}`,
        description: booking.notes ?? undefined,
        startTime:   booking.startTime,
        endTime:     booking.endTime,
        hostEmail:   booking.host.email!,
        hostName:    booking.host.name  ?? "Host",
        guestEmail:  booking.guestEmail,
        guestName:   booking.guestName,
        timezone:    booking.host.timezone ?? "UTC",
      });

      meetLink = calEvent.hangoutLink;

      await prisma.booking.update({
        where: { id: booking.id },
        data:  { calendarEventId: calEvent.id, meetLink },
      });
    } catch (err) {
      console.error("[Webhook] Calendar event creation failed:", err);
    }
  }

  await Promise.allSettled([
    sendBookingConfirmation({
      guestEmail: booking.guestEmail,
      guestName:  booking.guestName,
      hostName:   booking.host.name ?? "Host",
      eventTitle: booking.eventType.title,
      startTime:  booking.startTime,
      endTime:    booking.endTime,
      location:   booking.eventType.location ?? undefined,
      meetLink:   meetLink ?? undefined,
      amount:     payment.amount,
      currency:   payment.currency,
    }),
    sendHostNotification({
      hostEmail:  booking.host.email!,
      hostName:   booking.host.name  ?? "Host",
      guestName:  booking.guestName,
      guestEmail: booking.guestEmail,
      guestPhone: booking.guestPhone ?? undefined,
      eventTitle: booking.eventType.title,
      startTime:  booking.startTime,
      endTime:    booking.endTime,
      amount:     payment.amount,
      currency:   payment.currency,
    }),
  ]);
}

async function handleCaptureDenied(resource: any) {
  const captureId = resource.id as string | undefined;
  const orderId   = resource.supplementary_data?.related_ids?.order_id as string | undefined;

  if (!captureId && !orderId) return;

  const payment = await prisma.payment.findFirst({
    where: {
      OR: [
        ...(orderId   ? [{ paypalOrderId:   orderId   }] : []),
        ...(captureId ? [{ paypalCaptureId: captureId }] : []),
      ],
    },
  });

  if (!payment || payment.status === "COMPLETED") return;

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data:  { status: "DENIED", webhookVerified: true },
    }),
    prisma.booking.update({
      where: { id: payment.bookingId },
      data:  { status: "CANCELLED" },
    }),
  ]);
}
