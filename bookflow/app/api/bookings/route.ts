import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const bookings = await prisma.booking.findMany({
    where: {
      hostId: session.user.id,
      ...(status ? { status: status as any } : {}),
    },
    include: {
      eventType: true,
      payment: true,
    },
    orderBy: { startTime: "desc" },
  });

  return Response.json(bookings);
}
