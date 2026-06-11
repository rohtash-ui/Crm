"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

export default function SettingsPage() {
  const { data: session } = useSession();
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [calendarConnected, setCalendarConnected] = useState(false);

  useEffect(() => {
    fetch("/api/calendar/connect").then((r) => r.json()).then((d) => {
      setCalendarConnected(d.connected);
    });
  }, []);

  const handleSaveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const res = await fetch("/api/user/username", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });

    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setMessage(data.error || "Failed to save username");
    } else {
      setMessage("Username saved! Your booking link is ready.");
    }
  };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">Manage your account and integrations</p>
      </div>

      <div className="space-y-6">
        {/* Profile */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Profile</h2>
          <div className="flex items-center gap-4 mb-6">
            {session?.user?.image && (
              <img
                src={session.user.image}
                alt="Profile"
                className="w-16 h-16 rounded-full"
              />
            )}
            <div>
              <p className="font-medium text-gray-900">{session?.user?.name}</p>
              <p className="text-sm text-gray-500">{session?.user?.email}</p>
            </div>
          </div>

          <form onSubmit={handleSaveUsername}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <p className="text-xs text-gray-500 mb-2">
              This will be your public booking link: {appUrl}/book/<strong>{username || "your-username"}</strong>
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="your-username"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <button
                type="submit"
                disabled={saving}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
            {message && (
              <p className={`mt-2 text-sm ${message.includes("error") || message.includes("Failed") || message.includes("taken") ? "text-red-600" : "text-green-600"}`}>
                {message}
              </p>
            )}
          </form>
        </div>

        {/* Calendar Integration */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 mb-1">Google Calendar</h2>
          <p className="text-sm text-gray-500 mb-4">
            Automatically create calendar events after confirmed bookings.
          </p>
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${calendarConnected ? "bg-green-500" : "bg-gray-300"}`} />
            <span className="text-sm text-gray-700">
              {calendarConnected ? "Google Calendar connected" : "Not connected"}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Calendar access is granted when you sign in with Google. Ensure calendar scope is enabled in your Google OAuth app.
          </p>
        </div>

        {/* PayPal Info */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 mb-1">PayPal Payments</h2>
          <p className="text-sm text-gray-500 mb-4">
            PayPal is configured via environment variables.
          </p>
          <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-600 font-mono space-y-1">
            <p>PAYPAL_CLIENT_ID={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ? "✓ Set" : "⚠ Not set"}</p>
            <p>PAYPAL_MODE={process.env.PAYPAL_MODE || "sandbox"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
