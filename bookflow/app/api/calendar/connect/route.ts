import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { accessToken, refreshToken, expiresAt } = body;

  await prisma.calendarConnection.upsert({
    where: { userId_provider: { userId: session.user.id, provider: "google" } },
    create: {
      userId: session.user.id,
      provider: "google",
      accessToken,
      refreshToken,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
    update: {
      accessToken,
      refreshToken,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  });

  return Response.json({ success: true });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conn = await prisma.calendarConnection.findUnique({
    where: { userId_provider: { userId: session.user.id, provider: "google" } },
  });

  return Response.json({ connected: !!conn });
}
