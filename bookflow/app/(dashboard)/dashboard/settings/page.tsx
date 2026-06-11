"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

const POPULAR_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
];

export default function SettingsPage() {
  const { data: session } = useSession();
  const [username, setUsername] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/user/username").then((r) => r.json()),
      fetch("/api/calendar/connect").then((r) => r.json()),
    ]).then(([userData, calData]) => {
      if (userData.username) setUsername(userData.username);
      if (userData.timezone) setTimezone(userData.timezone);
      setCalendarConnected(calData.connected);
      setLoadingSettings(false);
    });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const res = await fetch("/api/user/username", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, timezone }),
    });

    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setMessage({ text: data.error || "Failed to save settings", ok: false });
    } else {
      setMessage({ text: "Settings saved successfully!", ok: true });
    }
  };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;

  if (loadingSettings) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">Manage your profile and integrations</p>
      </div>

      <div className="space-y-6 max-w-2xl">
        {/* Profile & Booking Link */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100">
            {session?.user?.image ? (
              <img src={session.user.image} alt="Profile" className="w-16 h-16 rounded-full" />
            ) : (
              <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center text-white text-xl font-bold">
                {session?.user?.name?.[0] || "?"}
              </div>
            )}
            <div>
              <p className="font-semibold text-gray-900 text-lg">{session?.user?.name}</p>
              <p className="text-sm text-gray-500">{session?.user?.email}</p>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username *
              </label>
              <p className="text-xs text-gray-400 mb-2">
                Your public booking link:{" "}
                <span className="font-mono text-blue-600">
                  {appUrl}/book/<strong>{username || "your-username"}</strong>
                </span>
              </p>
              <input
                type="text"
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                }
                placeholder="your-username"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
                minLength={3}
                maxLength={40}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Timezone
              </label>
              <p className="text-xs text-gray-400 mb-2">
                Used for calendar events and availability display.
              </p>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {POPULAR_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            {message && (
              <p
                className={`text-sm ${
                  message.ok ? "text-green-600" : "text-red-600"
                }`}
              >
                {message.ok ? "✓ " : "✗ "}
                {message.text}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
          </form>
        </div>

        {/* Google Calendar */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 mb-1">Google Calendar</h2>
              <p className="text-sm text-gray-500 max-w-sm">
                After a booking is confirmed, a Google Calendar event is automatically created
                with a Google Meet link sent to both you and your guest.
              </p>
            </div>
            <div
              className={`mt-1 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                calendarConnected
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  calendarConnected ? "bg-green-500" : "bg-gray-400"
                }`}
              />
              {calendarConnected ? "Connected" : "Not connected"}
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-4">
            Calendar access is granted automatically when you sign in with Google. Make sure
            your Google OAuth app has the{" "}
            <code className="bg-gray-100 px-1 rounded text-gray-600">calendar</code> scope enabled.
          </p>
        </div>

        {/* PayPal */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 mb-1">PayPal Payments</h2>
          <p className="text-sm text-gray-500 mb-4">
            PayPal credentials are configured via environment variables on the server.
          </p>
          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ? "bg-green-500" : "bg-red-400"
                }`}
              />
              <span className="text-gray-600">
                NEXT_PUBLIC_PAYPAL_CLIENT_ID:{" "}
                {process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ? "✓ Set" : "⚠ Not set"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gray-300" />
              <span className="text-gray-600">
                PAYPAL_MODE: {process.env.NEXT_PUBLIC_PAYPAL_MODE || "sandbox"}
              </span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Set <code className="bg-gray-100 px-1 rounded text-gray-600">PAYPAL_MODE=live</code>{" "}
            to switch from sandbox to live payments. Ensure your PayPal webhook is configured at{" "}
            <code className="bg-gray-100 px-1 rounded text-gray-600">/api/payments/webhook</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
