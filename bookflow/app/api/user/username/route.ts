import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { username } = await request.json();

  if (!username || !/^[a-z0-9-]+$/.test(username)) {
    return Response.json(
      { error: "Username can only contain lowercase letters, numbers, and hyphens" },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing && existing.id !== session.user.id) {
    return Response.json({ error: "Username already taken" }, { status: 409 });
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { username },
  });

  return Response.json({ username: user.username });
}
