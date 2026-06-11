import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const SLUG_REGEX = /^[a-z0-9-]+$/;
const ALLOWED_DURATIONS = [15, 30, 45, 60, 90, 120];
const ALLOWED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "INR"];

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id as string;
  const eventTypes = await prisma.eventType.findMany({
    where: { userId },
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

  const userId = (session.user as any).id as string;
  const body = await request.json();
  const { title, slug, description, duration, price, currency, color, location } = body;

  // Validation
  if (!title?.trim()) {
    return Response.json({ error: "Title is required" }, { status: 400 });
  }
  if (!slug || !SLUG_REGEX.test(slug)) {
    return Response.json(
      { error: "Slug must contain only lowercase letters, numbers, and hyphens" },
      { status: 400 }
    );
  }
  if (slug.length < 2 || slug.length > 60) {
    return Response.json({ error: "Slug must be between 2 and 60 characters" }, { status: 400 });
  }
  const dur = Number(duration);
  if (!ALLOWED_DURATIONS.includes(dur)) {
    return Response.json(
      { error: `Duration must be one of: ${ALLOWED_DURATIONS.join(", ")} minutes` },
      { status: 400 }
    );
  }
  const priceNum = Number(price ?? 0);
  if (isNaN(priceNum) || priceNum < 0 || priceNum > 100000) {
    return Response.json({ error: "Price must be between 0 and 100,000" }, { status: 400 });
  }
  const cur = currency || "USD";
  if (!ALLOWED_CURRENCIES.includes(cur)) {
    return Response.json({ error: `Currency must be one of: ${ALLOWED_CURRENCIES.join(", ")}` }, { status: 400 });
  }

  const existing = await prisma.eventType.findUnique({
    where: { userId_slug: { userId, slug } },
  });
  if (existing) {
    return Response.json({ error: "This slug is already in use" }, { status: 409 });
  }

  // Limit event types per user
  const count = await prisma.eventType.count({ where: { userId } });
  if (count >= 50) {
    return Response.json({ error: "Maximum of 50 event types allowed" }, { status: 400 });
  }

  const eventType = await prisma.eventType.create({
    data: {
      userId,
      title: title.trim(),
      slug,
      description: description?.trim() || null,
      duration: dur,
      price: priceNum,
      currency: cur,
      color: color || "#3B82F6",
      location: location?.trim() || null,
    },
  });

  return Response.json(eventType, { status: 201 });
}
