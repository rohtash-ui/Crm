import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import BookingFlow from "@/components/booking/BookingFlow";

export default async function BookEventPage({
  params,
}: {
  params: Promise<{ username: string; slug: string }>;
}) {
  const { username, slug } = await params;

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) notFound();

  const eventType = await prisma.eventType.findUnique({
    where: { userId_slug: { userId: user.id, slug } },
  });

  if (!eventType || !eventType.isActive) notFound();

  return (
    <BookingFlow
      username={username}
      eventType={{
        id: eventType.id,
        title: eventType.title,
        description: eventType.description || undefined,
        duration: eventType.duration,
        price: eventType.price,
        currency: eventType.currency,
        color: eventType.color,
        location: eventType.location || undefined,
        slug: eventType.slug,
      }}
      host={{ name: user.name || "Host", image: user.image || undefined }}
    />
  );
}
