import { prisma } from "@/lib/prisma";
import { generateTimeSlots } from "@/lib/slots";
import { getFreeBusyTimes } from "@/lib/google-calendar";
import { isGoogleCalendarConfigured } from "@/lib/env";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username");
  const slug = searchParams.get("slug");
  const date = searchParams.get("date");

  if (!username || !slug || !date) {
    return Response.json({ error: "Missing required params: username, slug, date" }, { status: 400 });
  }

  const parsedDate = new Date(date);
  if (isNaN(parsedDate.getTime())) {
    return Response.json({ error: "Invalid date format" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return Response.json({ error: "Host not found" }, { status: 404 });

  const eventType = await prisma.eventType.findUnique({
    where: { userId_slug: { userId: user.id, slug } },
  });
  if (!eventType || !eventType.isActive) {
    return Response.json({ error: "Event type not found or inactive" }, { status: 404 });
  }

  const dayOfWeek = parsedDate.getDay();
  const availability = await prisma.availability.findFirst({
    where: { userId: user.id, dayOfWeek, isActive: true },
  });

  if (!availability) {
    return Response.json({ slots: [], eventType });
  }

  const dayStart = new Date(parsedDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(parsedDate);
  dayEnd.setHours(23, 59, 59, 999);

  const [existingBookings, googleAccount, calConn] = await Promise.all([
    prisma.booking.findMany({
      where: {
        hostId: user.id,
        status: { in: ["CONFIRMED", "PENDING"] },
        startTime: { gte: dayStart, lte: dayEnd },
      },
      select: { startTime: true, endTime: true },
    }),
    prisma.account.findFirst({ where: { userId: user.id, provider: "google" } }),
    prisma.calendarConnection.findUnique({
      where: { userId_provider: { userId: user.id, provider: "google" } },
    }),
  ]);

  // Use Google Calendar FreeBusy if available
  let busyPeriods: { start: string; end: string }[] = [];
  if (
    isGoogleCalendarConfigured() &&
    googleAccount?.access_token &&
    calConn
  ) {
    busyPeriods = await getFreeBusyTimes(
      googleAccount.access_token,
      googleAccount.refresh_token || calConn.refreshToken || "",
      dayStart,
      dayEnd
    );
  }

  const slots = generateTimeSlots(
    parsedDate,
    eventType.duration,
    { startTime: availability.startTime, endTime: availability.endTime },
    busyPeriods,
    existingBookings
  );

  return Response.json({
    slots,
    eventType: {
      id: eventType.id,
      title: eventType.title,
      duration: eventType.duration,
      price: eventType.price,
      currency: eventType.currency,
    },
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { username, slug, startTime, guestName, guestEmail, guestPhone, guestTimezone, notes } = body;

  if (!username || !slug || !startTime || !guestName || !guestEmail) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(guestEmail)) {
    return Response.json({ error: "Invalid guest email address" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return Response.json({ error: "Host not found" }, { status: 404 });

  const eventType = await prisma.eventType.findUnique({
    where: { userId_slug: { userId: user.id, slug } },
  });
  if (!eventType || !eventType.isActive) {
    return Response.json({ error: "Event type not found or inactive" }, { status: 404 });
  }

  const start = new Date(startTime);
  if (isNaN(start.getTime())) {
    return Response.json({ error: "Invalid start time" }, { status: 400 });
  }

  // Prevent booking in the past
  if (start < new Date()) {
    return Response.json({ error: "Cannot book a time in the past" }, { status: 400 });
  }

  const end = new Date(start.getTime() + eventType.duration * 60000);

  // Check for slot conflicts atomically
  const conflict = await prisma.booking.findFirst({
    where: {
      hostId: user.id,
      status: { in: ["CONFIRMED", "PENDING"] },
      OR: [
        { startTime: { gte: start, lt: end } },
        { endTime: { gt: start, lte: end } },
        { AND: [{ startTime: { lte: start } }, { endTime: { gte: end } }] },
      ],
    },
  });

  if (conflict) {
    return Response.json({ error: "This time slot is no longer available" }, { status: 409 });
  }

  // Validate the requested slot is within host availability
  const dayOfWeek = start.getDay();
  const availability = await prisma.availability.findFirst({
    where: { userId: user.id, dayOfWeek, isActive: true },
  });

  if (!availability) {
    return Response.json({ error: "Host is not available on this day" }, { status: 409 });
  }

  const booking = await prisma.booking.create({
    data: {
      hostId: user.id,
      eventTypeId: eventType.id,
      guestName: guestName.trim(),
      guestEmail: guestEmail.trim().toLowerCase(),
      guestPhone: guestPhone?.trim() || null,
      guestTimezone: guestTimezone || "UTC",
      notes: notes?.trim() || null,
      startTime: start,
      endTime: end,
      status: "PENDING",
    },
  });

  if (eventType.price === 0) {
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED" } });
    return Response.json({ bookingId: booking.id, requiresPayment: false });
  }

  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      amount: eventType.price,
      currency: eventType.currency,
      status: "PENDING",
    },
  });

  return Response.json({
    bookingId: booking.id,
    paymentId: payment.id,
    requiresPayment: true,
    amount: eventType.price,
    currency: eventType.currency,
  });
}
