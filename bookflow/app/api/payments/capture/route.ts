import { prisma } from "@/lib/prisma";
import { capturePayPalOrder, getPayPalOrder } from "@/lib/paypal";
import { createCalendarEvent } from "@/lib/google-calendar";
import { sendBookingConfirmation, sendHostNotification } from "@/lib/email";
import { isGoogleCalendarConfigured } from "@/lib/env";

export async function POST(request: Request) {
  const { orderId, bookingId } = await request.json();

  if (!orderId || !bookingId) {
    return Response.json({ error: "Missing orderId or bookingId" }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      eventType: true,
      payment: true,
      host: {
        include: {
          calendarConnections: true,
          accounts: { where: { provider: "google" } },
        },
      },
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
    return Response.json({ success: true });
  }

  // Verify the order is in APPROVED state before capturing
  const orderStatus = await getPayPalOrder(orderId);
  if (!["APPROVED", "COMPLETED"].includes(orderStatus.status)) {
    return Response.json(
      { error: `Order is not approved. Current status: ${orderStatus.status}` },
      { status: 402 }
    );
  }

  let capture;
  try {
    capture = await capturePayPalOrder(orderId);
  } catch (err: any) {
    await prisma.payment.update({
      where: { bookingId },
      data: { status: "FAILED" },
    });
    return Response.json({ error: "Payment capture failed" }, { status: 402 });
  }

  if (capture.status !== "COMPLETED") {
    await prisma.payment.update({
      where: { bookingId },
      data: { status: capture.status === "VOIDED" ? "FAILED" : "DENIED" },
    });
    return Response.json(
      { error: `Payment was not completed. Status: ${capture.status}` },
      { status: 402 }
    );
  }

  const captureUnit = capture.purchase_units?.[0]?.payments?.captures?.[0];
  const captureId = captureUnit?.id;
  const payerEmail = capture.payer?.email_address;

  await prisma.$transaction([
    prisma.payment.update({
      where: { bookingId },
      data: {
        status: "COMPLETED",
        paypalCaptureId: captureId,
        paypalTxnId: captureId,
        paypalPayerEmail: payerEmail || null,
        webhookVerified: false,
      },
    }),
    prisma.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    }),
  ]);

  // Create Google Calendar event
  let meetLink: string | undefined;
  const calConn = booking.host.calendarConnections[0];
  const googleAccount = booking.host.accounts[0];

  if (
    isGoogleCalendarConfigured() &&
    calConn &&
    googleAccount?.access_token
  ) {
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
        where: { id: bookingId },
        data: { calendarEventId: calEvent.id || null },
      });
    } catch (err) {
      console.error("[Calendar] Failed to create event:", err);
    }
  }

  // Send emails
  const payment = booking.payment;
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
      notes: booking.notes || undefined,
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
      notes: booking.notes || undefined,
      amount: payment.amount,
      currency: payment.currency,
    }),
  ]);

  return Response.json({ success: true, meetLink });
}
