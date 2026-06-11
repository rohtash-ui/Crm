"use client";

import { useState, useEffect, useCallback } from "react";
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
  cancelReason?: string;
  rescheduledFrom?: string;
  eventType: { title: string; duration: number };
  payment?: { amount: number; currency: string; status: string; paypalTxnId?: string };
}

const STATUS_FILTERS = ["ALL", "PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"];

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-700",
  CONFIRMED: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
  COMPLETED: "bg-gray-100 text-gray-600",
  RESCHEDULED: "bg-blue-100 text-blue-700",
};

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [modal, setModal] = useState<"cancel" | "reschedule" | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [newDateTime, setNewDateTime] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  const fetchBookings = useCallback(() => {
    setLoading(true);
    const url = filter === "ALL" ? "/api/bookings" : `/api/bookings?status=${filter}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setBookings(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  const closeModal = () => {
    setModal(null);
    setSelectedBooking(null);
    setCancelReason("");
    setNewDateTime("");
    setActionError("");
  };

  const handleCancel = async () => {
    if (!selectedBooking) return;
    setActionLoading(true);
    setActionError("");

    const res = await fetch(`/api/bookings/${selectedBooking.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", cancelReason }),
    });

    const data = await res.json();
    setActionLoading(false);

    if (!res.ok) {
      setActionError(data.error || "Failed to cancel booking");
      return;
    }

    closeModal();
    fetchBookings();
  };

  const handleReschedule = async () => {
    if (!selectedBooking || !newDateTime) return;
    setActionLoading(true);
    setActionError("");

    const res = await fetch(`/api/bookings/${selectedBooking.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reschedule", newStartTime: new Date(newDateTime).toISOString() }),
    });

    const data = await res.json();
    setActionLoading(false);

    if (!res.ok) {
      setActionError(data.error || "Failed to reschedule booking");
      return;
    }

    closeModal();
    fetchBookings();
  };

  const canActOn = (b: Booking) =>
    b.status === "CONFIRMED" || b.status === "PENDING";

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Bookings</h1>
        <p className="text-gray-500 text-sm mt-1">Manage all your bookings</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => { setFilter(s); }}
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
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : bookings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
          <p className="text-4xl mb-3">📭</p>
          <p className="font-semibold text-gray-900">No bookings found</p>
          <p className="text-gray-400 text-sm mt-1">
            {filter !== "ALL" ? `No ${filter.toLowerCase()} bookings` : "Share your booking link to get started"}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {["Guest", "Event", "Date & Time", "Payment", "Status", "Actions"].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-900">{b.guestName}</p>
                      <p className="text-gray-400 text-xs">{b.guestEmail}</p>
                      {b.guestPhone && (
                        <p className="text-gray-400 text-xs">{b.guestPhone}</p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-gray-700">{b.eventType.title}</p>
                      <p className="text-gray-400 text-xs">{b.eventType.duration} min</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-gray-700">{format(new Date(b.startTime), "MMM d, yyyy")}</p>
                      <p className="text-gray-400 text-xs">
                        {format(new Date(b.startTime), "h:mm a")} –{" "}
                        {format(new Date(b.endTime), "h:mm a")}
                      </p>
                      {b.rescheduledFrom && (
                        <p className="text-xs text-blue-500 mt-0.5">
                          ↔ Rescheduled
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {b.payment ? (
                        <>
                          <p className="font-medium text-gray-700">
                            {b.payment.amount.toFixed(2)} {b.payment.currency}
                          </p>
                          <p className={`text-xs ${b.payment.status === "COMPLETED" ? "text-green-600" : "text-gray-400"}`}>
                            {b.payment.status}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">Free</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLORS[b.status] || "bg-gray-100 text-gray-600"}`}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {canActOn(b) && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setSelectedBooking(b); setModal("reschedule"); }}
                            className="text-xs text-blue-600 border border-blue-200 px-2.5 py-1.5 rounded-lg hover:bg-blue-50"
                          >
                            Reschedule
                          </button>
                          <button
                            onClick={() => { setSelectedBooking(b); setModal("cancel"); }}
                            className="text-xs text-red-600 border border-red-200 px-2.5 py-1.5 rounded-lg hover:bg-red-50"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cancel modal */}
      {modal === "cancel" && selectedBooking && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="font-semibold text-gray-900 text-lg mb-1">Cancel booking</h3>
            <p className="text-gray-500 text-sm mb-4">
              Cancel <strong>{selectedBooking.guestName}</strong>'s booking for{" "}
              <strong>{selectedBooking.eventType.title}</strong> on{" "}
              {format(new Date(selectedBooking.startTime), "MMM d 'at' h:mm a")}?
            </p>
            {actionError && (
              <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
                {actionError}
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason (optional — sent to guest)
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="Let the guest know why…"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={closeModal}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Keep booking
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="flex-1 bg-red-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? "Cancelling…" : "Cancel booking"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule modal */}
      {modal === "reschedule" && selectedBooking && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="font-semibold text-gray-900 text-lg mb-1">Reschedule booking</h3>
            <p className="text-gray-500 text-sm mb-4">
              Current time: <strong>{format(new Date(selectedBooking.startTime), "MMM d 'at' h:mm a")}</strong>
            </p>
            {actionError && (
              <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
                {actionError}
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                New date & time *
              </label>
              <input
                type="datetime-local"
                value={newDateTime}
                onChange={(e) => setNewDateTime(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={closeModal}
                className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReschedule}
                disabled={actionLoading || !newDateTime}
                className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {actionLoading ? "Rescheduling…" : "Confirm reschedule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
