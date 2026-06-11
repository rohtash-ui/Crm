"use client";

import { useState, useEffect } from "react";
import { format, addDays, startOfDay, isSameDay, isBefore } from "date-fns";
import Image from "next/image";
import PayPalButton from "./PayPalButton";

interface EventType {
  id: string;
  title: string;
  description?: string;
  duration: number;
  price: number;
  currency: string;
  color: string;
  location?: string;
  slug: string;
}

interface Host {
  name: string;
  image?: string;
}

type Step = "date" | "time" | "form" | "payment" | "confirm";

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export default function BookingFlow({
  username,
  eventType,
  host,
}: {
  username: string;
  eventType: EventType;
  host: Host;
}) {
  const [step, setStep] = useState<Step>("date");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [guestTimezone, setGuestTimezone] = useState(detectTimezone);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [booking, setBooking] = useState<{
    id: string;
    requiresPayment: boolean;
    amount?: number;
    currency?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [meetLink, setMeetLink] = useState<string | undefined>();

  const today = startOfDay(new Date());
  const calendarDays = Array.from({ length: 42 }, (_, i) => addDays(today, i));

  const handleDateSelect = async (date: Date) => {
    if (isBefore(date, today)) return;
    setSelectedDate(date);
    setSelectedSlot(null);
    setLoadingSlots(true);
    setError("");

    try {
      const res = await fetch(
        `/api/bookings/public?username=${encodeURIComponent(username)}&slug=${encodeURIComponent(eventType.slug)}&date=${date.toISOString()}`
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to load time slots");
        setSlots([]);
      } else {
        setSlots(data.slots || []);
      }
    } catch {
      setError("Failed to load time slots. Please try again.");
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }

    setStep("time");
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/bookings/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          slug: eventType.slug,
          startTime: selectedSlot,
          guestName: form.name.trim(),
          guestEmail: form.email.trim(),
          guestPhone: form.phone.trim() || undefined,
          guestTimezone,
          notes: form.notes.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create booking. Please try again.");
        return;
      }

      setBooking(data);

      if (!data.requiresPayment) {
        setStep("confirm");
      } else {
        setStep("payment");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentSuccess = async (orderId: string) => {
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/payments/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, bookingId: booking!.id }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Payment captured but confirmation failed. Please contact support.");
        return;
      }

      setMeetLink(data.meetLink);
      setStep("confirm");
    } catch {
      setError("Network error during payment confirmation. Please contact support.");
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "confirm") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Booking Confirmed!</h1>
          <p className="text-gray-500 mb-6 text-sm">
            A confirmation email has been sent to <strong>{form.email}</strong>.
          </p>

          <div className="bg-gray-50 rounded-xl p-5 text-left mb-6 space-y-2">
            <p className="font-semibold text-gray-900">{eventType.title}</p>
            {selectedSlot && (
              <>
                <p className="text-sm text-gray-600">
                  📅 {format(new Date(selectedSlot), "EEEE, MMMM d, yyyy")}
                </p>
                <p className="text-sm text-gray-600">
                  🕐 {format(new Date(selectedSlot), "h:mm a")} ({eventType.duration} min)
                </p>
              </>
            )}
            {eventType.location && (
              <p className="text-sm text-gray-600">📍 {eventType.location}</p>
            )}
            {meetLink && (
              <p className="text-sm">
                🎥{" "}
                <a href={meetLink} className="text-blue-600 underline break-all" target="_blank" rel="noreferrer">
                  Join Google Meet
                </a>
              </p>
            )}
          </div>

          <a
            href={`/book/${username}`}
            className="text-blue-600 text-sm hover:underline"
          >
            ← Back to {host.name}'s page
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-10">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex flex-col md:flex-row">
            {/* Left info panel */}
            <div className="md:w-72 border-b md:border-b-0 md:border-r border-gray-100 p-6 md:p-8">
              <div className="flex items-center gap-3 mb-5">
                {host.image ? (
                  <Image src={host.image} alt={host.name} width={40} height={40} className="rounded-full" />
                ) : (
                  <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0">
                    {host.name[0]}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">with</p>
                  <p className="font-semibold text-gray-900 truncate">{host.name}</p>
                </div>
              </div>

              <div className="w-3 h-3 rounded-full mb-2" style={{ backgroundColor: eventType.color }} />
              <h2 className="text-xl font-bold text-gray-900 mb-2">{eventType.title}</h2>
              {eventType.description && (
                <p className="text-sm text-gray-500 mb-4 leading-relaxed">{eventType.description}</p>
              )}

              <div className="space-y-1.5 text-sm text-gray-600">
                <p className="flex items-center gap-2">
                  <span>🕐</span> {eventType.duration} min
                </p>
                {eventType.location && (
                  <p className="flex items-center gap-2">
                    <span>📍</span> {eventType.location}
                  </p>
                )}
                <p className="flex items-center gap-2 font-semibold text-gray-900">
                  <span>💳</span>
                  {eventType.price === 0
                    ? "Free"
                    : `${eventType.price.toFixed(2)} ${eventType.currency}`}
                </p>
              </div>

              {(selectedDate || selectedSlot) && (
                <div className="mt-5 pt-5 border-t border-gray-100 space-y-1 text-sm text-gray-600">
                  {selectedDate && (
                    <p className="font-medium text-gray-900">
                      {format(selectedDate, "EEEE, MMMM d")}
                    </p>
                  )}
                  {selectedSlot && (
                    <p>{format(new Date(selectedSlot), "h:mm a")}</p>
                  )}
                </div>
              )}
            </div>

            {/* Right flow panel */}
            <div className="flex-1 p-6 md:p-8 min-h-[400px]">
              {/* Date picker */}
              {step === "date" && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-5">Select a date</h3>
                  <div className="grid grid-cols-7 gap-1">
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                      <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">
                        {d}
                      </div>
                    ))}
                    {Array.from({ length: today.getDay() }, (_, i) => (
                      <div key={`e${i}`} />
                    ))}
                    {calendarDays.map((date) => {
                      const past = isBefore(date, today);
                      const active = !!(selectedDate && isSameDay(date, selectedDate));
                      return (
                        <button
                          key={date.toISOString()}
                          onClick={() => handleDateSelect(date)}
                          disabled={past}
                          className={`aspect-square flex items-center justify-center rounded-full text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                            active
                              ? "bg-blue-600 text-white"
                              : "text-gray-700 hover:bg-blue-50 hover:text-blue-700"
                          }`}
                        >
                          {format(date, "d")}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Time slots */}
              {step === "time" && (
                <div>
                  <button onClick={() => setStep("date")} className="flex items-center gap-1 text-blue-600 text-sm mb-4 hover:underline">
                    ← Back
                  </button>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    {selectedDate && format(selectedDate, "EEEE, MMMM d")}
                  </h3>
                  <p className="text-xs text-gray-400 mb-5">All times in {guestTimezone}</p>

                  {loadingSlots ? (
                    <div className="flex items-center gap-3 text-gray-400 text-sm py-8">
                      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      Loading available times…
                    </div>
                  ) : error ? (
                    <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
                  ) : slots.length === 0 ? (
                    <div className="text-center py-10">
                      <p className="text-gray-400 text-sm">No available times on this date.</p>
                      <button onClick={() => setStep("date")} className="text-blue-600 text-sm mt-2 hover:underline">
                        Choose another date
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {slots.map((slot) => (
                        <button
                          key={slot}
                          onClick={() => { setSelectedSlot(slot); setStep("form"); }}
                          className="border border-blue-200 text-blue-700 rounded-lg py-2.5 text-sm font-medium hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-colors"
                        >
                          {format(new Date(slot), "h:mm a")}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Guest form */}
              {step === "form" && (
                <div>
                  <button onClick={() => setStep("time")} className="flex items-center gap-1 text-blue-600 text-sm mb-4 hover:underline">
                    ← Back
                  </button>
                  <h3 className="text-lg font-semibold text-gray-900 mb-5">Your details</h3>

                  {error && (
                    <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
                      {error}
                    </div>
                  )}

                  <form onSubmit={handleFormSubmit} className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Full name *
                        </label>
                        <input
                          type="text"
                          value={form.name}
                          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          required
                          autoComplete="name"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Email *
                        </label>
                        <input
                          type="email"
                          value={form.email}
                          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          required
                          autoComplete="email"
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Phone
                        </label>
                        <input
                          type="tel"
                          value={form.phone}
                          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoComplete="tel"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Your timezone
                        </label>
                        <select
                          value={guestTimezone}
                          onChange={(e) => setGuestTimezone(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {TIMEZONES.map((tz) => (
                            <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Notes
                      </label>
                      <textarea
                        value={form.notes}
                        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        rows={3}
                        placeholder="Anything you'd like me to know before the meeting?"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                      {submitting && (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      )}
                      {submitting
                        ? "Processing…"
                        : eventType.price > 0
                          ? `Continue to payment — ${eventType.price.toFixed(2)} ${eventType.currency}`
                          : "Confirm booking"}
                    </button>
                  </form>
                </div>
              )}

              {/* Payment */}
              {step === "payment" && booking && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Complete payment</h3>
                  <p className="text-gray-500 text-sm mb-2">
                    Pay{" "}
                    <strong>
                      {booking.amount?.toFixed(2)} {booking.currency}
                    </strong>{" "}
                    to confirm your booking with {host.name}.
                  </p>
                  <div className="bg-blue-50 text-blue-800 text-xs px-4 py-3 rounded-lg mb-6">
                    🔒 Your booking is held for 15 minutes while you complete payment.
                  </div>

                  {error && (
                    <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
                      {error}
                    </div>
                  )}

                  {submitting ? (
                    <div className="flex items-center gap-3 text-gray-500 text-sm py-4">
                      <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      Confirming your booking…
                    </div>
                  ) : (
                    <PayPalButton
                      bookingId={booking.id}
                      amount={booking.amount!}
                      currency={booking.currency!}
                      onSuccess={handlePaymentSuccess}
                      onError={(msg) => setError(msg)}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Powered by <a href="/" className="hover:underline">BookFlow</a>
        </p>
      </div>
    </div>
  );
}
