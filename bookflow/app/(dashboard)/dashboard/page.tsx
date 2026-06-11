import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { format } from "date-fns";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [eventTypesCount, bookings, paymentsTotal] = await Promise.all([
    prisma.eventType.count({ where: { userId, isActive: true } }),
    prisma.booking.findMany({
      where: { hostId: userId },
      include: { eventType: true, payment: true },
      orderBy: { startTime: "desc" },
      take: 5,
    }),
    prisma.payment.aggregate({
      where: { booking: { hostId: userId }, status: "COMPLETED" },
      _sum: { amount: true },
    }),
  ]);

  const confirmedCount = await prisma.booking.count({
    where: { hostId: userId, status: "CONFIRMED" },
  });

  const user = await prisma.user.findUnique({ where: { id: userId } });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {session!.user!.name?.split(" ")[0]}!
        </h1>
        {!user?.username && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center justify-between">
            <p className="text-amber-800 text-sm">
              Set up your username to get your public booking link.
            </p>
            <Link
              href="/dashboard/settings"
              className="text-amber-800 font-medium text-sm underline"
            >
              Set username →
            </Link>
          </div>
        )}
        {user?.username && (
          <p className="text-gray-500 mt-1 text-sm">
            Your booking link:{" "}
            <Link
              href={`/book/${user.username}`}
              className="text-blue-600 hover:underline font-medium"
              target="_blank"
            >
              {process.env.NEXT_PUBLIC_APP_URL}/book/{user.username}
            </Link>
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-6 mb-8">
        {[
          { label: "Active Event Types", value: eventTypesCount, icon: "📋" },
          { label: "Confirmed Bookings", value: confirmedCount, icon: "✅" },
          {
            label: "Total Revenue",
            value: `$${(paymentsTotal._sum.amount || 0).toFixed(2)}`,
            icon: "💰",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm"
          >
            <div className="text-2xl mb-2">{stat.icon}</div>
            <div className="text-3xl font-bold text-gray-900 mb-1">{stat.value}</div>
            <div className="text-sm text-gray-500">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Recent bookings */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent Bookings</h2>
          <Link href="/dashboard/bookings" className="text-blue-600 text-sm hover:underline">
            View all
          </Link>
        </div>
        {bookings.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400">
            <p className="text-4xl mb-3">📭</p>
            <p className="font-medium">No bookings yet</p>
            <p className="text-sm mt-1">Share your booking link to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {bookings.map((booking) => (
              <div key={booking.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{booking.guestName}</p>
                  <p className="text-sm text-gray-500">
                    {booking.eventType.title} ·{" "}
                    {format(new Date(booking.startTime), "MMM d, h:mm a")}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {booking.payment && (
                    <span className="text-sm font-medium text-gray-700">
                      ${booking.payment.amount.toFixed(2)}
                    </span>
                  )}
                  <span
                    className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      booking.status === "CONFIRMED"
                        ? "bg-green-100 text-green-700"
                        : booking.status === "PENDING"
                          ? "bg-yellow-100 text-yellow-700"
                          : booking.status === "CANCELLED"
                            ? "bg-red-100 text-red-700"
                            : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {booking.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
