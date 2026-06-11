import { prisma } from "@/lib/prisma";
import { createPayPalOrder } from "@/lib/paypal";
import { isPayPalConfigured } from "@/lib/env";

export async function POST(request: Request) {
  if (!isPayPalConfigured()) {
    return Response.json({ error: "PayPal is not configured on this server" }, { status: 503 });
  }

  const { bookingId } = await request.json();

  if (!bookingId) {
    return Response.json({ error: "Missing bookingId" }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { eventType: true, payment: true },
  });

  if (!booking) {
    return Response.json({ error: "Booking not found" }, { status: 404 });
  }

  if (!booking.payment) {
    return Response.json({ error: "No payment record for this booking" }, { status: 400 });
  }

  if (booking.payment.status !== "PENDING") {
    return Response.json({ error: `Payment is already ${booking.payment.status}` }, { status: 400 });
  }

  // Reuse existing PayPal order if already created
  if (booking.payment.paypalOrderId) {
    return Response.json({ orderId: booking.payment.paypalOrderId });
  }

  let order;
  try {
    order = await createPayPalOrder(
      booking.payment.amount,
      booking.payment.currency,
      `${booking.eventType.title} — ${booking.guestName}`
    );
  } catch (err: any) {
    console.error("[PayPal] Create order failed:", err);
    return Response.json({ error: "Failed to create PayPal order" }, { status: 502 });
  }

  await prisma.payment.update({
    where: { bookingId },
    data: { paypalOrderId: order.id },
  });

  return Response.json({ orderId: order.id });
}
