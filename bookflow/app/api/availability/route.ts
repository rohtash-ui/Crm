import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id as string;
  const availability = await prisma.availability.findMany({
    where: { userId },
    orderBy: { dayOfWeek: "asc" },
  });

  return Response.json(availability);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id as string;
  const body = await request.json();
  const { availability } = body;

  if (!Array.isArray(availability)) {
    return Response.json({ error: "availability must be an array" }, { status: 400 });
  }

  // Validate each entry
  for (const a of availability) {
    if (a.dayOfWeek < 0 || a.dayOfWeek > 6) {
      return Response.json({ error: `Invalid dayOfWeek: ${a.dayOfWeek}` }, { status: 400 });
    }
    if (!TIME_REGEX.test(a.startTime)) {
      return Response.json({ error: `Invalid startTime: ${a.startTime}` }, { status: 400 });
    }
    if (!TIME_REGEX.test(a.endTime)) {
      return Response.json({ error: `Invalid endTime: ${a.endTime}` }, { status: 400 });
    }
    if (a.startTime >= a.endTime) {
      return Response.json(
        { error: `startTime must be before endTime for day ${a.dayOfWeek}` },
        { status: 400 }
      );
    }
  }

  await prisma.$transaction([
    prisma.availability.deleteMany({ where: { userId } }),
    prisma.availability.createMany({
      data: availability.map(
        (a: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }) => ({
          userId,
          dayOfWeek: Number(a.dayOfWeek),
          startTime: a.startTime,
          endTime: a.endTime,
          isActive: Boolean(a.isActive),
        })
      ),
    }),
  ]);

  const updated = await prisma.availability.findMany({
    where: { userId },
    orderBy: { dayOfWeek: "asc" },
  });

  return Response.json(updated);
}
