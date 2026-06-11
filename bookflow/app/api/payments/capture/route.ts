import { prisma } from "@/lib/prisma";
import { capturePayPalOrder } from "@/lib/paypal";
import { createCalendarEvent } from "@/lib/google-calendar";
import { sendBookingConfirmation, sendHostNotification } from "@/lib/email";

export async function POST(request: Request) {
  const { orderId, bookingId } = await request.json();

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
    return Response.json({ error: "Order ID mismatch" }, { status: 400 });
  }

  const capture = await capturePayPalOrder(orderId);

  if (capture.status !== "COMPLETED") {
    await prisma.payment.update({
      where: { bookingId },
      data: { status: "FAILED" },
    });
    return Response.json({ error: "Payment failed" }, { status: 402 });
  }

  const txnId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id;

  await prisma.payment.update({
    where: { bookingId },
    data: { status: "COMPLETED", paypalTxnId: txnId },
  });

  await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "CONFIRMED" },
  });

  // Create Google Calendar event
  let meetLink: string | undefined;
  const calConn = booking.host.calendarConnections[0];
  const googleAccount = booking.host.accounts[0];

  if (calConn && googleAccount?.access_token) {
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
        }
      );

      meetLink = calEvent.hangoutLink || undefined;

      await prisma.booking.update({
        where: { id: bookingId },
        data: { calendarEventId: calEvent.id },
      });
    } catch (err) {
      console.error("Calendar event creation failed:", err);
    }
  }

  // Send emails
  try {
    await Promise.all([
      sendBookingConfirmation({
        guestEmail: booking.guestEmail,
        guestName: booking.guestName,
        hostName: booking.host.name || "Host",
        eventTitle: booking.eventType.title,
        startTime: booking.startTime,
        endTime: booking.endTime,
        location: booking.eventType.location || undefined,
        meetLink,
      }),
      sendHostNotification({
        hostEmail: booking.host.email!,
        hostName: booking.host.name || "Host",
        guestName: booking.guestName,
        guestEmail: booking.guestEmail,
        eventTitle: booking.eventType.title,
        startTime: booking.startTime,
        endTime: booking.endTime,
        notes: booking.notes || undefined,
      }),
    ]);
  } catch (err) {
    console.error("Email sending failed:", err);
  }

  return Response.json({ success: true, meetLink });
}
