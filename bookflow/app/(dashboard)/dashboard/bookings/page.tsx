"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";

interface Booking {
  id: string;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  notes?: string;
  startTime: string;
  endTime: string;
  status: string;
  eventType: { title: string; duration: number };
  payment?: { amount: number; currency: string; status: string; paypalTxnId?: string };
}

const statusFilters = ["ALL", "PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"];

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");

  useEffect(() => {
    const url = filter === "ALL" ? "/api/bookings" : `/api/bookings?status=${filter}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setBookings(data);
        setLoading(false);
      });
  }, [filter]);

  const statusColor: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-700",
    CONFIRMED: "bg-green-100 text-green-700",
    CANCELLED: "bg-red-100 text-red-700",
    COMPLETED: "bg-gray-100 text-gray-600",
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Bookings</h1>
        <p className="text-gray-500 text-sm mt-1">Manage all your bookings</p>
      </div>

      <div className="flex gap-2 mb-6">
        {statusFilters.map((s) => (
          <button
            key={s}
            onClick={() => { setFilter(s); setLoading(true); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === s
                ? "bg-blue-600 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : bookings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-4xl mb-3">📭</p>
          <p className="font-medium text-gray-900">No bookings found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {["Guest", "Event", "Date & Time", "Payment", "Status"].map((h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bookings.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900">{b.guestName}</p>
                    <p className="text-gray-500 text-xs">{b.guestEmail}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-gray-700">{b.eventType.title}</p>
                    <p className="text-gray-400 text-xs">{b.eventType.duration} min</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-gray-700">{format(new Date(b.startTime), "MMM d, yyyy")}</p>
                    <p className="text-gray-400 text-xs">
                      {format(new Date(b.startTime), "h:mm a")} –{" "}
                      {format(new Date(b.endTime), "h:mm a")}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    {b.payment ? (
                      <>
                        <p className="font-medium text-gray-700">
                          ${b.payment.amount.toFixed(2)} {b.payment.currency}
                        </p>
                        <p className="text-xs text-gray-400">{b.payment.status}</p>
                      </>
                    ) : (
                      <span className="text-gray-400 text-xs">Free</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor[b.status] || "bg-gray-100 text-gray-600"}`}
                    >
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
