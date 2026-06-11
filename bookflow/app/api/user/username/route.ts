import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const USERNAME_REGEX = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED = new Set([
  "admin", "api", "auth", "book", "dashboard", "login", "logout",
  "signup", "register", "settings", "profile", "help", "support",
  "about", "terms", "privacy", "pricing", "bookflow", "www",
]);

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id as string;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, timezone: true },
  });

  return Response.json(user);
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id as string;
  const body = await request.json();
  const { username, timezone } = body;

  const updates: Record<string, string> = {};

  if (username !== undefined) {
    if (!username || !USERNAME_REGEX.test(username)) {
      return Response.json(
        {
          error:
            "Username must be 3–40 characters, contain only lowercase letters, numbers, and hyphens, and not start or end with a hyphen.",
        },
        { status: 400 }
      );
    }
    if (RESERVED.has(username.toLowerCase())) {
      return Response.json({ error: "This username is reserved" }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing && existing.id !== userId) {
      return Response.json({ error: "Username is already taken" }, { status: 409 });
    }
    updates.username = username;
  }

  if (timezone !== undefined) {
    // Basic timezone validation
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      updates.timezone = timezone;
    } catch {
      return Response.json({ error: "Invalid timezone" }, { status: 400 });
    }
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: updates,
    select: { username: true, timezone: true },
  });

  return Response.json(user);
}
