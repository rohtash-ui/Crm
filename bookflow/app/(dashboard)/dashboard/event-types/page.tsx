"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface EventType {
  id: string;
  title: string;
  slug: string;
  description?: string;
  duration: number;
  price: number;
  currency: string;
  color: string;
  isActive: boolean;
  _count?: { bookings: number };
}

export default function EventTypesPage() {
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "",
    slug: "",
    description: "",
    duration: "30",
    price: "0",
    currency: "USD",
    color: "#3B82F6",
    location: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/event-types")
      .then((r) => r.json())
      .then((data) => {
        setEventTypes(data);
        setLoading(false);
      });
  }, []);

  const handleTitleChange = (v: string) => {
    setForm((f) => ({
      ...f,
      title: v,
      slug: v.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const res = await fetch("/api/event-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "Failed to create event type");
      return;
    }

    setEventTypes((prev) => [{ ...data, _count: { bookings: 0 } }, ...prev]);
    setShowForm(false);
    setForm({ title: "", slug: "", description: "", duration: "30", price: "0", currency: "USD", color: "#3B82F6", location: "" });
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await fetch(`/api/event-types/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    setEventTypes((prev) =>
      prev.map((et) => (et.id === id ? { ...et, isActive: !isActive } : et))
    );
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this event type?")) return;
    await fetch(`/api/event-types/${id}`, { method: "DELETE" });
    setEventTypes((prev) => prev.filter((et) => et.id !== id));
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Event Types</h1>
          <p className="text-gray-500 text-sm mt-1">Create and manage your bookable services</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + New event type
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">New Event Type</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="30-min consultation"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Slug *</label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="What's this booking for?"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Duration (min) *</label>
                  <select
                    value={form.duration}
                    onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {[15, 30, 45, 60, 90, 120].map((d) => (
                      <option key={d} value={d}>{d} minutes</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price (USD)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0 for free"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Google Meet / Zoom / Office"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {eventTypes.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-4xl mb-3">📋</p>
          <h3 className="font-semibold text-gray-900 mb-1">No event types yet</h3>
          <p className="text-gray-500 text-sm mb-4">Create your first bookable service</p>
          <button
            onClick={() => setShowForm(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Create event type
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {eventTypes.map((et) => (
            <div
              key={et.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
            >
              <div className="flex items-center">
                <div className="w-1.5 self-stretch" style={{ backgroundColor: et.color }} />
                <div className="flex-1 px-6 py-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{et.title}</h3>
                      {!et.isActive && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {et.duration} min ·{" "}
                      {et.price === 0 ? "Free" : `$${et.price.toFixed(2)} ${et.currency}`} ·{" "}
                      {et._count?.bookings || 0} bookings
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggle(et.id, et.isActive)}
                      className="text-xs border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50"
                    >
                      {et.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => handleDelete(et.id)}
                      className="text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
