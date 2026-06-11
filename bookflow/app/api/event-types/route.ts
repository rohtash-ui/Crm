import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const eventTypes = await prisma.eventType.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { bookings: true } } },
  });

  return Response.json(eventTypes);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { title, slug, description, duration, price, currency, color, location } = body;

  if (!title || !slug || !duration) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const existing = await prisma.eventType.findUnique({
    where: { userId_slug: { userId: session.user.id, slug } },
  });

  if (existing) {
    return Response.json({ error: "Slug already in use" }, { status: 409 });
  }

  const eventType = await prisma.eventType.create({
    data: {
      userId: session.user.id,
      title,
      slug,
      description,
      duration: Number(duration),
      price: Number(price || 0),
      currency: currency || "USD",
      color: color || "#3B82F6",
      location,
    },
  });

  return Response.json(eventType, { status: 201 });
}
