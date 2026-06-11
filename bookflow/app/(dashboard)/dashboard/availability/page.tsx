"use client";

import { useState, useEffect } from "react";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface DayAvailability {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

const defaultAvailability: DayAvailability[] = DAYS.map((_, i) => ({
  dayOfWeek: i,
  startTime: "09:00",
  endTime: "17:00",
  isActive: i >= 1 && i <= 5,
}));

export default function AvailabilityPage() {
  const [availability, setAvailability] = useState<DayAvailability[]>(defaultAvailability);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/availability")
      .then((r) => r.json())
      .then((data) => {
        if (data && data.length > 0) {
          const merged = defaultAvailability.map((def) => {
            const found = data.find((d: DayAvailability) => d.dayOfWeek === def.dayOfWeek);
            return found || def;
          });
          setAvailability(merged);
        }
        setLoading(false);
      });
  }, []);

  const update = (dayOfWeek: number, field: keyof DayAvailability, value: string | boolean) => {
    setAvailability((prev) =>
      prev.map((a) => (a.dayOfWeek === dayOfWeek ? { ...a, [field]: value } : a))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    await fetch("/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ availability }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  if (loading) return <div className="text-center py-12 text-gray-400">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Availability</h1>
          <p className="text-gray-500 text-sm mt-1">Set your weekly working hours</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : saved ? "✓ Saved" : "Save availability"}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="divide-y divide-gray-100">
          {availability.map((day) => (
            <div key={day.dayOfWeek} className="flex items-center gap-6 px-6 py-4">
              <div className="flex items-center gap-3 w-32">
                <input
                  type="checkbox"
                  checked={day.isActive}
                  onChange={(e) => update(day.dayOfWeek, "isActive", e.target.checked)}
                  className="w-4 h-4 accent-blue-600 cursor-pointer"
                />
                <span className={`text-sm font-medium ${day.isActive ? "text-gray-900" : "text-gray-400"}`}>
                  {DAYS[day.dayOfWeek]}
                </span>
              </div>
              {day.isActive ? (
                <div className="flex items-center gap-3">
                  <input
                    type="time"
                    value={day.startTime}
                    onChange={(e) => update(day.dayOfWeek, "startTime", e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-gray-400 text-sm">to</span>
                  <input
                    type="time"
                    value={day.endTime}
                    onChange={(e) => update(day.dayOfWeek, "endTime", e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ) : (
                <span className="text-sm text-gray-400">Unavailable</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
