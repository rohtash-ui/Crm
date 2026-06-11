import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { testCalendarConnection, getPrimaryCalendarInfo } from "@/lib/google-calendar";
import { isGoogleCalendarConfigured } from "@/lib/env";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id as string;

  const conn = await prisma.calendarConnection.findUnique({
    where: { userId_provider: { userId, provider: "google" } },
    select: {
      id:             true,
      connectedEmail: true,
      calendarId:     true,
      expiresAt:      true,
      updatedAt:      true,
    },
  });

  if (!conn) {
    return Response.json({
      connected:     false,
      configured:    isGoogleCalendarConfigured(),
    });
  }

  // Return lightweight status without making an API call
  return Response.json({
    connected:      true,
    configured:     isGoogleCalendarConfigured(),
    connectedEmail: conn.connectedEmail,
    calendarId:     conn.calendarId,
    tokenExpiresAt: conn.expiresAt,
    lastSynced:     conn.updatedAt,
  });
}

// DELETE — disconnect Google Calendar
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id as string;

  await prisma.calendarConnection.deleteMany({
    where: { userId, provider: "google" },
  });

  return Response.json({ success: true, message: "Google Calendar disconnected." });
}

// POST — manually trigger a connection test and return calendar info
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGoogleCalendarConfigured()) {
    return Response.json(
      { error: "Google Calendar API is not configured on this server." },
      { status: 503 }
    );
  }

  const userId = (session.user as any).id as string;

  const conn = await prisma.calendarConnection.findUnique({
    where: { userId_provider: { userId, provider: "google" } },
  });

  if (!conn) {
    return Response.json(
      { error: "No Google Calendar connection found. Sign in with Google first." },
      { status: 404 }
    );
  }

  const isValid = await testCalendarConnection(userId);
  if (!isValid) {
    return Response.json(
      { error: "Could not reach Google Calendar. Try signing in with Google again." },
      { status: 502 }
    );
  }

  const calInfo = await getPrimaryCalendarInfo(userId);

  // Persist calendar display name
  if (calInfo?.id) {
    await prisma.calendarConnection.update({
      where: { userId_provider: { userId, provider: "google" } },
      data:  { calendarId: calInfo.id },
    });
  }

  return Response.json({
    success:        true,
    calendarName:   calInfo?.summary,
    calendarId:     calInfo?.id,
    connectedEmail: conn.connectedEmail,
  });
}
