import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  const eventType = await prisma.eventType.findUnique({ where: { id } });
  if (!eventType || eventType.userId !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const { title, description, duration, price, currency, color, location, isActive } = body;

  // Validate any provided field
  if (duration !== undefined) {
    const dur = Number(duration);
    if (![15, 30, 45, 60, 90, 120].includes(dur)) {
      return Response.json({ error: "Invalid duration" }, { status: 400 });
    }
  }
  if (price !== undefined) {
    const p = Number(price);
    if (isNaN(p) || p < 0 || p > 100000) {
      return Response.json({ error: "Price must be between 0 and 100,000" }, { status: 400 });
    }
  }

  const updated = await prisma.eventType.update({
    where: { id },
    data: {
      title: title?.trim() || undefined,
      description: description !== undefined ? description?.trim() || null : undefined,
      duration: duration !== undefined ? Number(duration) : undefined,
      price: price !== undefined ? Number(price) : undefined,
      currency: currency || undefined,
      color: color || undefined,
      location: location !== undefined ? location?.trim() || null : undefined,
      isActive: isActive !== undefined ? Boolean(isActive) : undefined,
    },
  });

  return Response.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id as string;
  const { id } = await params;

  const eventType = await prisma.eventType.findUnique({ where: { id } });
  if (!eventType || eventType.userId !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Check for future confirmed bookings
  const futureBookings = await prisma.booking.count({
    where: {
      eventTypeId: id,
      status: { in: ["CONFIRMED", "PENDING"] },
      startTime: { gt: new Date() },
    },
  });

  if (futureBookings > 0) {
    return Response.json(
      { error: `Cannot delete event type with ${futureBookings} upcoming booking(s). Cancel them first.` },
      { status: 409 }
    );
  }

  await prisma.eventType.delete({ where: { id } });
  return Response.json({ success: true });
}
