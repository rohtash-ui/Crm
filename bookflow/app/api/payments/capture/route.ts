import { prisma } from "@/lib/prisma";
import { capturePayPalOrder, getPayPalOrder } from "@/lib/paypal";
import { createCalendarEvent } from "@/lib/google-calendar";
import { sendBookingConfirmation, sendHostNotification } from "@/lib/email";
import { isGoogleCalendarConfigured } from "@/lib/env";

export async function POST(request: Request) {
  const body = await request.json();
  const { orderId, bookingId } = body;

  if (!orderId || !bookingId) {
    return Response.json({ error: "Missing orderId or bookingId" }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      eventType: true,
      payment: true,
      host: true,
    },
  });

  if (!booking || !booking.payment) {
    return Response.json({ error: "Booking not found" }, { status: 404 });
  }

  if (booking.payment.paypalOrderId !== orderId) {
    return Response.json({ error: "Order ID does not match this booking" }, { status: 400 });
  }

  // Idempotent: already confirmed
  if (booking.status === "CONFIRMED" && booking.payment.status === "COMPLETED") {
    return Response.json({ success: true, meetLink: booking.meetLink });
  }

  // Verify PayPal order is APPROVED before capturing
  const orderStatus = await getPayPalOrder(orderId);
  if (!["APPROVED", "COMPLETED"].includes(orderStatus.status)) {
    return Response.json(
      { error: `Payment not approved. Current status: ${orderStatus.status}` },
      { status: 402 }
    );
  }

  // Capture the payment
  let capture;
  try {
    capture = await capturePayPalOrder(orderId);
  } catch {
    await prisma.payment.update({ where: { bookingId }, data: { status: "FAILED" } });
    return Response.json({ error: "Payment capture failed" }, { status: 402 });
  }

  if (capture.status !== "COMPLETED") {
    await prisma.payment.update({
      where: { bookingId },
      data: { status: capture.status === "VOIDED" ? "FAILED" : "DENIED" },
    });
    return Response.json(
      { error: `Payment not completed. Status: ${capture.status}` },
      { status: 402 }
    );
  }

  const captureUnit = capture.purchase_units?.[0]?.payments?.captures?.[0];
  const captureId   = captureUnit?.id;
  const payerEmail  = capture.payer?.email_address;

  // Confirm payment + booking atomically
  await prisma.$transaction([
    prisma.payment.update({
      where: { bookingId },
      data: {
        status: "COMPLETED",
        paypalCaptureId:  captureId   ?? null,
        paypalTxnId:      captureId   ?? null,
        paypalPayerEmail: payerEmail  ?? null,
        webhookVerified:  false,
      },
    }),
    prisma.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    }),
  ]);

  // ── Google Calendar event ──────────────────────────────────────────────────
  let meetLink: string | null = null;

  if (isGoogleCalendarConfigured()) {
    try {
      const calEvent = await createCalendarEvent(booking.hostId, {
        summary:     `${booking.eventType.title} with ${booking.guestName}`,
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
        where: { id: bookingId },
        data: {
          calendarEventId: calEvent.id,
          meetLink:        meetLink,
        },
      });
    } catch (err) {
      // Non-fatal — booking is already confirmed; log and continue
      console.error("[Calendar] Event creation failed:", err);
    }
  }

  // ── Confirmation emails ────────────────────────────────────────────────────
  await Promise.allSettled([
    sendBookingConfirmation({
      guestEmail:  booking.guestEmail,
      guestName:   booking.guestName,
      hostName:    booking.host.name  ?? "Host",
      eventTitle:  booking.eventType.title,
      startTime:   booking.startTime,
      endTime:     booking.endTime,
      location:    booking.eventType.location ?? undefined,
      meetLink:    meetLink ?? undefined,
      notes:       booking.notes ?? undefined,
      amount:      booking.payment.amount,
      currency:    booking.payment.currency,
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
      notes:      booking.notes ?? undefined,
      amount:     booking.payment.amount,
      currency:   booking.payment.currency,
    }),
  ]);

  return Response.json({ success: true, meetLink });
}
