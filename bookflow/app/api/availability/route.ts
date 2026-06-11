import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const availability = await prisma.availability.findMany({
    where: { userId: session.user.id },
    orderBy: { dayOfWeek: "asc" },
  });

  return Response.json(availability);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  // Replace all availability for user
  await prisma.availability.deleteMany({ where: { userId: session.user.id } });

  const records = await prisma.availability.createMany({
    data: body.availability.map(
      (a: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }) => ({
        userId: session.user.id,
        dayOfWeek: a.dayOfWeek,
        startTime: a.startTime,
        endTime: a.endTime,
        isActive: a.isActive,
      })
    ),
  });

  return Response.json({ count: records.count });
}
