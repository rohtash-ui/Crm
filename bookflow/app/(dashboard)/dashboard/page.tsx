import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { format } from "date-fns";

export default async function DashboardPage() {
  const session = await auth();
  const userId = (session!.user as any).id as string;

  const [eventTypesCount, bookings, paymentsAgg, confirmedCount, user] = await Promise.all([
    prisma.eventType.count({ where: { userId, isActive: true } }),
    prisma.booking.findMany({
      where: { hostId: userId },
      include: { eventType: true, payment: true },
      orderBy: { startTime: "desc" },
      take: 6,
    }),
    prisma.payment.aggregate({
      where: { booking: { hostId: userId }, status: "COMPLETED" },
      _sum: { amount: true },
    }),
    prisma.booking.count({ where: { hostId: userId, status: "CONFIRMED" } }),
    prisma.user.findUnique({ where: { id: userId }, select: { username: true, timezone: true } }),
  ]);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const revenue = paymentsAgg._sum.amount || 0;

  const statusColor: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-700",
    CONFIRMED: "bg-green-100 text-green-700",
    CANCELLED: "bg-red-100 text-red-700",
    COMPLETED: "bg-gray-100 text-gray-600",
    RESCHEDULED: "bg-blue-100 text-blue-700",
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {session!.user!.name?.split(" ")[0]}!
        </h1>

        {!user?.username ? (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="font-medium text-amber-900 text-sm">Set up your booking link</p>
              <p className="text-amber-700 text-xs mt-0.5">
                You need a username before clients can book with you.
              </p>
            </div>
            <Link
              href="/dashboard/settings"
              className="inline-flex items-center gap-1 bg-amber-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-amber-700 transition-colors flex-shrink-0"
            >
              Set username →
            </Link>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-gray-500 text-sm">Your link:</span>
            <a
              href={`/book/${user.username}`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 text-sm hover:underline font-medium"
            >
              {appUrl}/book/{user.username}
            </a>
            <button
              onClick={() => {}}
              className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded px-2 py-0.5"
              aria-label="Copy link"
            >
              Copy
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
        {[
          { label: "Active Event Types", value: eventTypesCount, icon: "📋", href: "/dashboard/event-types" },
          { label: "Confirmed Bookings", value: confirmedCount, icon: "✅", href: "/dashboard/bookings" },
          {
            label: "Total Revenue",
            value: `$${revenue.toFixed(2)}`,
            icon: "💰",
            href: "/dashboard/bookings",
          },
        ].map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300 transition-all"
          >
            <div className="text-2xl mb-3">{stat.icon}</div>
            <div className="text-3xl font-bold text-gray-900 mb-1">{stat.value}</div>
            <div className="text-sm text-gray-500">{stat.label}</div>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      {eventTypesCount === 0 && (
        <div className="bg-white rounded-xl border border-blue-100 bg-blue-50 p-6 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-blue-900">Create your first event type</p>
            <p className="text-blue-700 text-sm mt-0.5">
              Define what services you offer, how long they take, and how much they cost.
            </p>
          </div>
          <Link
            href="/dashboard/event-types"
            className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 flex-shrink-0"
          >
            Create event type
          </Link>
        </div>
      )}

      {/* Recent bookings */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent Bookings</h2>
          <Link href="/dashboard/bookings" className="text-blue-600 text-sm hover:underline">
            View all →
          </Link>
        </div>

        {bookings.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-4xl mb-3">📭</p>
            <p className="font-medium text-gray-700">No bookings yet</p>
            <p className="text-sm text-gray-400 mt-1 mb-5">
              Share your booking link to start getting bookings
            </p>
            {user?.username && (
              <a
                href={`/book/${user.username}`}
                target="_blank"
                rel="noreferrer"
                className="inline-block bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Open booking page →
              </a>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {bookings.map((booking) => (
              <div key={booking.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-0 sm:justify-between">
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
                    className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor[booking.status] || "bg-gray-100 text-gray-600"}`}
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
