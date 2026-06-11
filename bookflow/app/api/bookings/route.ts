import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BookingStatus } from "@prisma/client";

const VALID_STATUSES = new Set<string>(Object.values(BookingStatus));

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id as string;
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  if (status && !VALID_STATUSES.has(status)) {
    return Response.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const bookings = await prisma.booking.findMany({
    where: {
      hostId: userId,
      ...(status ? { status: status as BookingStatus } : {}),
    },
    include: {
      eventType: { select: { title: true, duration: true, color: true } },
      payment:   true,
    },
    orderBy: { startTime: "desc" },
  });

  return Response.json(bookings);
}
