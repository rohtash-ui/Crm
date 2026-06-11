import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const eventType = await prisma.eventType.findUnique({ where: { id } });
  if (!eventType || eventType.userId !== session.user.id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.eventType.update({
    where: { id },
    data: {
      title: body.title,
      description: body.description,
      duration: body.duration ? Number(body.duration) : undefined,
      price: body.price !== undefined ? Number(body.price) : undefined,
      currency: body.currency,
      color: body.color,
      location: body.location,
      isActive: body.isActive,
    },
  });

  return Response.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const eventType = await prisma.eventType.findUnique({ where: { id } });
  if (!eventType || eventType.userId !== session.user.id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.eventType.delete({ where: { id } });
  return Response.json({ success: true });
}
