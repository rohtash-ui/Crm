"use client";

import { useState } from "react";
import { format, addDays, startOfDay, isSameDay } from "date-fns";
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
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [booking, setBooking] = useState<{
    id: string;
    requiresPayment: boolean;
    amount?: number;
    currency?: string;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const today = startOfDay(new Date());
  const calendarDays = Array.from({ length: 30 }, (_, i) => addDays(today, i));

  const handleDateSelect = async (date: Date) => {
    setSelectedDate(date);
    setSelectedSlot(null);
    setLoadingSlots(true);

    const res = await fetch(
      `/api/bookings/public?username=${username}&slug=${eventType.slug}&date=${date.toISOString()}`
    );
    const data = await res.json();
    setSlots(data.slots || []);
    setLoadingSlots(false);
    setStep("time");
  };

  const handleSlotSelect = (slot: string) => {
    setSelectedSlot(slot);
    setStep("form");
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const res = await fetch("/api/bookings/public", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        slug: eventType.slug,
        startTime: selectedSlot,
        ...form,
        guestName: form.name,
        guestEmail: form.email,
        guestPhone: form.phone,
      }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error || "Booking failed");
      return;
    }

    setBooking(data);

    if (!data.requiresPayment) {
      setConfirmed(true);
      setStep("confirm");
    } else {
      setStep("payment");
    }
  };

  const handlePaymentSuccess = async (orderId: string) => {
    const res = await fetch("/api/payments/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, bookingId: booking!.id }),
    });

    if (res.ok) {
      setConfirmed(true);
      setStep("confirm");
    } else {
      setError("Payment capture failed. Please contact support.");
    }
  };

  if (step === "confirm" || confirmed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">✓</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Booking Confirmed!</h1>
          <p className="text-gray-500 mb-6">
            A confirmation email has been sent to {form.email}.
          </p>
          {selectedSlot && (
            <div className="bg-gray-50 rounded-xl p-4 text-left mb-6">
              <p className="text-sm font-medium text-gray-900">{eventType.title}</p>
              <p className="text-sm text-gray-500 mt-1">
                {format(new Date(selectedSlot), "EEEE, MMMM d, yyyy")}
              </p>
              <p className="text-sm text-gray-500">
                {format(new Date(selectedSlot), "h:mm a")} ({eventType.duration} min)
              </p>
              {eventType.location && (
                <p className="text-sm text-gray-500 mt-1">📍 {eventType.location}</p>
              )}
            </div>
          )}
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
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex">
            {/* Left panel */}
            <div className="w-72 border-r border-gray-100 p-8 flex-shrink-0">
              <div className="flex items-center gap-3 mb-6">
                {host.image ? (
                  <Image src={host.image} alt={host.name} width={40} height={40} className="rounded-full" />
                ) : (
                  <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold">
                    {host.name[0]}
                  </div>
                )}
                <div>
                  <p className="text-xs text-gray-500">with</p>
                  <p className="font-semibold text-gray-900">{host.name}</p>
                </div>
              </div>

              <div
                className="w-3 h-3 rounded-full mb-3"
                style={{ backgroundColor: eventType.color }}
              />
              <h2 className="text-xl font-bold text-gray-900 mb-2">{eventType.title}</h2>
              {eventType.description && (
                <p className="text-sm text-gray-500 mb-4">{eventType.description}</p>
              )}

              <div className="space-y-2 text-sm text-gray-600">
                <p>🕐 {eventType.duration} min</p>
                {eventType.location && <p>📍 {eventType.location}</p>}
                <p className="font-semibold text-gray-900">
                  {eventType.price === 0 ? "Free" : `$${eventType.price.toFixed(2)} ${eventType.currency}`}
                </p>
              </div>

              {selectedDate && (
                <div className="mt-6 pt-6 border-t border-gray-100 text-sm text-gray-600">
                  <p className="font-medium text-gray-900">
                    {format(selectedDate, "EEEE, MMMM d")}
                  </p>
                  {selectedSlot && (
                    <p className="mt-1">{format(new Date(selectedSlot), "h:mm a")}</p>
                  )}
                </div>
              )}
            </div>

            {/* Right panel */}
            <div className="flex-1 p-8">
              {step === "date" && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-6">Select a date</h3>
                  <div className="grid grid-cols-7 gap-1.5">
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                      <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">
                        {d}
                      </div>
                    ))}
                    {Array.from({ length: today.getDay() }, (_, i) => (
                      <div key={`empty-${i}`} />
                    ))}
                    {calendarDays.map((date) => (
                      <button
                        key={date.toISOString()}
                        onClick={() => handleDateSelect(date)}
                        className={`aspect-square flex items-center justify-center rounded-full text-sm font-medium transition-colors ${
                          selectedDate && isSameDay(date, selectedDate)
                            ? "bg-blue-600 text-white"
                            : "text-gray-700 hover:bg-blue-50 hover:text-blue-600"
                        }`}
                      >
                        {format(date, "d")}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === "time" && (
                <div>
                  <button
                    onClick={() => setStep("date")}
                    className="text-blue-600 text-sm mb-4 hover:underline"
                  >
                    ← Back
                  </button>
                  <h3 className="text-lg font-semibold text-gray-900 mb-6">
                    {selectedDate && format(selectedDate, "EEEE, MMMM d")}
                  </h3>
                  {loadingSlots ? (
                    <p className="text-gray-400 text-sm">Loading available times...</p>
                  ) : slots.length === 0 ? (
                    <p className="text-gray-400 text-sm">No available times on this date.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {slots.map((slot) => (
                        <button
                          key={slot}
                          onClick={() => handleSlotSelect(slot)}
                          className="border border-blue-200 text-blue-700 rounded-lg py-2.5 text-sm font-medium hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-colors"
                        >
                          {format(new Date(slot), "h:mm a")}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {step === "form" && (
                <div>
                  <button
                    onClick={() => setStep("time")}
                    className="text-blue-600 text-sm mb-4 hover:underline"
                  >
                    ← Back
                  </button>
                  <h3 className="text-lg font-semibold text-gray-900 mb-6">Your details</h3>
                  {error && (
                    <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
                      {error}
                    </div>
                  )}
                  <form onSubmit={handleFormSubmit} className="space-y-4">
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
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Phone
                      </label>
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
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
                        placeholder="Anything you'd like me to know?"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {submitting
                        ? "Processing..."
                        : eventType.price > 0
                          ? `Continue to payment ($${eventType.price.toFixed(2)})`
                          : "Confirm booking"}
                    </button>
                  </form>
                </div>
              )}

              {step === "payment" && booking && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Complete payment</h3>
                  <p className="text-gray-500 text-sm mb-6">
                    Pay ${booking.amount?.toFixed(2)} {booking.currency} to confirm your booking.
                  </p>
                  {error && (
                    <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
                      {error}
                    </div>
                  )}
                  <PayPalButton
                    bookingId={booking.id}
                    amount={booking.amount!}
                    currency={booking.currency!}
                    onSuccess={handlePaymentSuccess}
                    onError={(msg) => setError(msg)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
