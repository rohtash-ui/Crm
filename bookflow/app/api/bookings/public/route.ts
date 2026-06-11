import { prisma } from "@/lib/prisma";
import { generateTimeSlots } from "@/lib/slots";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username");
  const slug = searchParams.get("slug");
  const date = searchParams.get("date");

  if (!username || !slug || !date) {
    return Response.json({ error: "Missing params" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return Response.json({ error: "User not found" }, { status: 404 });

  const eventType = await prisma.eventType.findUnique({
    where: { userId_slug: { userId: user.id, slug } },
  });

  if (!eventType || !eventType.isActive) {
    return Response.json({ error: "Event type not found" }, { status: 404 });
  }

  const selectedDate = new Date(date);
  const dayOfWeek = selectedDate.getDay();

  const availability = await prisma.availability.findFirst({
    where: { userId: user.id, dayOfWeek, isActive: true },
  });

  if (!availability) {
    return Response.json({ slots: [] });
  }

  const existingBookings = await prisma.booking.findMany({
    where: {
      hostId: user.id,
      status: { in: ["CONFIRMED", "PENDING"] },
      startTime: {
        gte: new Date(selectedDate.setHours(0, 0, 0, 0)),
        lt: new Date(selectedDate.setHours(23, 59, 59, 999)),
      },
    },
  });

  const slots = generateTimeSlots(
    new Date(date),
    eventType.duration,
    { startTime: availability.startTime, endTime: availability.endTime },
    [],
    existingBookings
  );

  return Response.json({ slots, eventType });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { username, slug, startTime, guestName, guestEmail, guestPhone, notes } = body;

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return Response.json({ error: "User not found" }, { status: 404 });

  const eventType = await prisma.eventType.findUnique({
    where: { userId_slug: { userId: user.id, slug } },
  });

  if (!eventType || !eventType.isActive) {
    return Response.json({ error: "Event type not found" }, { status: 404 });
  }

  const start = new Date(startTime);
  const end = new Date(start.getTime() + eventType.duration * 60000);

  // Check for conflicts
  const conflict = await prisma.booking.findFirst({
    where: {
      hostId: user.id,
      status: { in: ["CONFIRMED", "PENDING"] },
      OR: [
        { startTime: { gte: start, lt: end } },
        { endTime: { gt: start, lte: end } },
      ],
    },
  });

  if (conflict) {
    return Response.json({ error: "Time slot no longer available" }, { status: 409 });
  }

  const booking = await prisma.booking.create({
    data: {
      hostId: user.id,
      eventTypeId: eventType.id,
      guestName,
      guestEmail,
      guestPhone,
      notes,
      startTime: start,
      endTime: end,
      status: "PENDING",
    },
  });

  // If event is free, confirm immediately
  if (eventType.price === 0) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CONFIRMED" },
    });
    return Response.json({ bookingId: booking.id, requiresPayment: false });
  }

  // Create payment record for paid bookings
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
