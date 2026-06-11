import { prisma } from "@/lib/prisma";
import { createPayPalOrder } from "@/lib/paypal";

export async function POST(request: Request) {
  const { bookingId } = await request.json();

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { eventType: true, payment: true },
  });

  if (!booking) {
    return Response.json({ error: "Booking not found" }, { status: 404 });
  }

  if (!booking.payment || booking.payment.status !== "PENDING") {
    return Response.json({ error: "No pending payment" }, { status: 400 });
  }

  const order = await createPayPalOrder(
    booking.payment.amount,
    booking.payment.currency,
    `${booking.eventType.title} - ${booking.guestName}`
  );

  await prisma.payment.update({
    where: { bookingId },
    data: { paypalOrderId: order.id },
  });

  return Response.json({ orderId: order.id });
}
