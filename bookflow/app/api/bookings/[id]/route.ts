import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteCalendarEvent, updateCalendarEvent } from "@/lib/google-calendar";
import { sendCancellationEmail, sendRescheduleEmail } from "@/lib/email";
import { isGoogleCalendarConfigured } from "@/lib/env";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { eventType: true, payment: true },
  });

  if (!booking || booking.hostId !== (session.user as any).id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(booking);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id as string;
  const { id } = await params;
  const body = await request.json();
  const { action, newStartTime, cancelReason } = body;

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      eventType: true,
      host: {
        include: {
          accounts: { where: { provider: "google" } },
          calendarConnections: true,
        },
      },
    },
  });

  if (!booking || booking.hostId !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (booking.status === "CANCELLED") {
    return Response.json({ error: "Booking is already cancelled" }, { status: 400 });
  }

  if (action === "cancel") {
    const googleAccount = booking.host.accounts[0];
    const calConn = booking.host.calendarConnections[0];

    // Delete calendar event
    if (
      booking.calendarEventId &&
      isGoogleCalendarConfigured() &&
      googleAccount?.access_token
    ) {
      await deleteCalendarEvent(
        googleAccount.access_token,
        googleAccount.refresh_token || calConn?.refreshToken || "",
        booking.calendarEventId
      ).catch((err) => console.error("[Cancel] Calendar delete failed:", err));
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: cancelReason?.trim() || null,
      },
    });

    // Send cancellation email to guest
    await sendCancellationEmail({
      guestEmail: booking.guestEmail,
      guestName: booking.guestName,
      hostName: booking.host.name || "Host",
      eventTitle: booking.eventType.title,
      startTime: booking.startTime,
      cancelReason: cancelReason?.trim() || undefined,
    }).catch((err) => console.error("[Cancel] Email failed:", err));

    return Response.json(updated);
  }

  if (action === "reschedule") {
    if (!newStartTime) {
      return Response.json({ error: "newStartTime is required for rescheduling" }, { status: 400 });
    }

    const newStart = new Date(newStartTime);
    if (isNaN(newStart.getTime())) {
      return Response.json({ error: "Invalid newStartTime" }, { status: 400 });
    }

    if (newStart < new Date()) {
      return Response.json({ error: "Cannot reschedule to a past time" }, { status: 400 });
    }

    const newEnd = new Date(newStart.getTime() + booking.eventType.duration * 60000);

    // Check for conflicts excluding this booking
    const conflict = await prisma.booking.findFirst({
      where: {
        hostId: userId,
        id: { not: id },
        status: { in: ["CONFIRMED", "PENDING"] },
        OR: [
          { startTime: { gte: newStart, lt: newEnd } },
          { endTime: { gt: newStart, lte: newEnd } },
          { AND: [{ startTime: { lte: newStart } }, { endTime: { gte: newEnd } }] },
        ],
      },
    });

    if (conflict) {
      return Response.json({ error: "New time slot is not available" }, { status: 409 });
    }

    const oldStartTime = booking.startTime;
    const googleAccount = booking.host.accounts[0];
    const calConn = booking.host.calendarConnections[0];

    // Update calendar event
    if (
      booking.calendarEventId &&
      isGoogleCalendarConfigured() &&
      googleAccount?.access_token
    ) {
      await updateCalendarEvent(
        googleAccount.access_token,
        googleAccount.refresh_token || calConn?.refreshToken || "",
        booking.calendarEventId,
        { startTime: newStart, endTime: newEnd, timezone: booking.host.timezone || "UTC" }
      ).catch((err) => console.error("[Reschedule] Calendar update failed:", err));
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        startTime: newStart,
        endTime: newEnd,
        status: "CONFIRMED",
        rescheduledFrom: oldStartTime.toISOString(),
      },
    });

    await sendRescheduleEmail({
      guestEmail: booking.guestEmail,
      guestName: booking.guestName,
      hostName: booking.host.name || "Host",
      eventTitle: booking.eventType.title,
      oldStartTime,
      newStartTime: newStart,
      newEndTime: newEnd,
      location: booking.eventType.location || undefined,
    }).catch((err) => console.error("[Reschedule] Email failed:", err));

    return Response.json(updated);
  }

  return Response.json({ error: "Invalid action. Use 'cancel' or 'reschedule'" }, { status: 400 });
}
