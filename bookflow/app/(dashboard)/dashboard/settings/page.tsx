"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { format } from "date-fns";

const TIMEZONES = [
  "UTC",
  "America/New_York",    "America/Chicago",  "America/Denver",
  "America/Los_Angeles", "America/Toronto",  "America/Vancouver",
  "America/Sao_Paulo",   "Europe/London",    "Europe/Paris",
  "Europe/Berlin",       "Europe/Madrid",    "Europe/Rome",
  "Europe/Moscow",       "Asia/Dubai",       "Asia/Karachi",
  "Asia/Kolkata",        "Asia/Dhaka",       "Asia/Bangkok",
  "Asia/Singapore",      "Asia/Tokyo",       "Asia/Seoul",
  "Asia/Shanghai",       "Australia/Sydney", "Australia/Melbourne",
  "Pacific/Auckland",
];

interface CalendarStatus {
  connected: boolean;
  configured: boolean;
  connectedEmail?: string;
  calendarId?: string;
  tokenExpiresAt?: string;
  lastSynced?: string;
}

export default function SettingsPage() {
  const { data: session } = useSession();

  // Profile state
  const [username,        setUsername]        = useState("");
  const [timezone,        setTimezone]        = useState("UTC");
  const [profileSaving,   setProfileSaving]   = useState(false);
  const [profileMsg,      setProfileMsg]      = useState<{ text: string; ok: boolean } | null>(null);

  // Calendar state
  const [calStatus,       setCalStatus]       = useState<CalendarStatus | null>(null);
  const [calTesting,      setCalTesting]      = useState(false);
  const [calTestMsg,      setCalTestMsg]      = useState<{ text: string; ok: boolean } | null>(null);
  const [disconnecting,   setDisconnecting]   = useState(false);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/user/username").then((r) => r.json()),
      fetch("/api/calendar/connect").then((r) => r.json()),
    ]).then(([u, cal]) => {
      if (u.username) setUsername(u.username);
      if (u.timezone) setTimezone(u.timezone);
      setCalStatus(cal);
      setLoading(false);
    });
  }, []);

  // ── Profile save ───────────────────────────────────────────────────────────
  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg(null);

    const res = await fetch("/api/user/username", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, timezone }),
    });
    const data = await res.json();
    setProfileSaving(false);
    setProfileMsg(
      res.ok
        ? { text: "Settings saved.", ok: true }
        : { text: data.error ?? "Failed to save settings.", ok: false }
    );
  };

  // ── Calendar test ──────────────────────────────────────────────────────────
  const handleTestCalendar = async () => {
    setCalTesting(true);
    setCalTestMsg(null);

    const res = await fetch("/api/calendar/connect", { method: "POST" });
    const data = await res.json();
    setCalTesting(false);

    if (res.ok) {
      setCalTestMsg({
        text: `✓ Connected to "${data.calendarName ?? "Primary Calendar"}" (${data.connectedEmail ?? ""})`,
        ok: true,
      });
      // Refresh status
      fetch("/api/calendar/connect")
        .then((r) => r.json())
        .then(setCalStatus);
    } else {
      setCalTestMsg({ text: data.error ?? "Connection test failed.", ok: false });
    }
  };

  // ── Calendar disconnect ────────────────────────────────────────────────────
  const handleDisconnect = async () => {
    if (!confirm("Disconnect Google Calendar? New bookings won't create calendar events or Meet links until you reconnect.")) return;

    setDisconnecting(true);
    setCalTestMsg(null);

    const res = await fetch("/api/calendar/connect", { method: "DELETE" });
    setDisconnecting(false);

    if (res.ok) {
      setCalStatus({ connected: false, configured: calStatus?.configured ?? true });
      setCalTestMsg({ text: "Google Calendar disconnected.", ok: true });
    } else {
      const data = await res.json();
      setCalTestMsg({ text: data.error ?? "Failed to disconnect.", ok: false });
    }
  };

  const appUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">Profile, integrations, and billing</p>
      </div>

      <div className="space-y-6 max-w-2xl">

        {/* ── Profile ─────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center gap-4 pb-5 mb-5 border-b border-gray-100">
            {session?.user?.image ? (
              <img
                src={session.user.image}
                alt="Profile"
                className="w-14 h-14 rounded-full border border-gray-200"
              />
            ) : (
              <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center text-white text-xl font-bold">
                {session?.user?.name?.[0] ?? "?"}
              </div>
            )}
            <div>
              <p className="font-semibold text-gray-900">{session?.user?.name}</p>
              <p className="text-sm text-gray-500">{session?.user?.email}</p>
            </div>
          </div>

          <form onSubmit={handleProfileSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username *
              </label>
              <p className="text-xs text-gray-400 mb-2">
                Booking link:{" "}
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
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            {profileMsg && (
              <p className={`text-sm ${profileMsg.ok ? "text-green-600" : "text-red-600"}`}>
                {profileMsg.text}
              </p>
            )}

            <button
              type="submit"
              disabled={profileSaving}
              className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {profileSaving ? "Saving…" : "Save settings"}
            </button>
          </form>
        </section>

        {/* ── Google Calendar ──────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <svg className="w-5 h-5" viewBox="0 0 48 48" fill="none">
                  <path d="M34 6H14L6 14v20l8 8h20l8-8V14l-8-8z" fill="#1a73e8" />
                  <path d="M14 6v8H6" fill="#185abc" />
                  <rect x="14" y="20" width="20" height="3" rx="1" fill="white" />
                  <rect x="14" y="27" width="14" height="3" rx="1" fill="white" />
                </svg>
                Google Calendar
              </h2>
              <p className="text-sm text-gray-500 mt-1 max-w-sm">
                Auto-create calendar events with Google Meet links after confirmed bookings.
                Checks your calendar for conflicts when showing available slots.
              </p>
            </div>

            {/* Status badge */}
            <span
              className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ${
                calStatus?.connected
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  calStatus?.connected ? "bg-green-500" : "bg-gray-400"
                }`}
              />
              {calStatus?.connected ? "Connected" : "Not connected"}
            </span>
          </div>

          {/* Connected details */}
          {calStatus?.connected && (
            <div className="bg-gray-50 rounded-lg p-4 mb-4 text-sm space-y-1.5">
              {calStatus.connectedEmail && (
                <div className="flex gap-2">
                  <span className="text-gray-500 w-28 flex-shrink-0">Account</span>
                  <span className="text-gray-800 font-medium">{calStatus.connectedEmail}</span>
                </div>
              )}
              {calStatus.calendarId && (
                <div className="flex gap-2">
                  <span className="text-gray-500 w-28 flex-shrink-0">Calendar ID</span>
                  <span className="text-gray-700 font-mono text-xs">{calStatus.calendarId}</span>
                </div>
              )}
              {calStatus.tokenExpiresAt && (
                <div className="flex gap-2">
                  <span className="text-gray-500 w-28 flex-shrink-0">Token expires</span>
                  <span className="text-gray-700">
                    {format(new Date(calStatus.tokenExpiresAt), "MMM d, yyyy h:mm a")}
                  </span>
                </div>
              )}
              {calStatus.lastSynced && (
                <div className="flex gap-2">
                  <span className="text-gray-500 w-28 flex-shrink-0">Last synced</span>
                  <span className="text-gray-700">
                    {format(new Date(calStatus.lastSynced), "MMM d, yyyy h:mm a")}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Not connected notice */}
          {!calStatus?.connected && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 mb-4 text-sm text-amber-800">
              <strong>Not connected.</strong> Sign in with Google (or sign out and back in) to
              grant calendar access. Tokens are synced automatically on every login.
            </div>
          )}

          {calTestMsg && (
            <p className={`text-sm mb-3 ${calTestMsg.ok ? "text-green-600" : "text-red-600"}`}>
              {calTestMsg.text}
            </p>
          )}

          {/* Action buttons */}
          {!calStatus?.configured ? (
            <p className="text-xs text-gray-400">
              Google Calendar API is not configured on this server.
              Set <code className="bg-gray-100 rounded px-1">GOOGLE_CLIENT_ID</code> and{" "}
              <code className="bg-gray-100 rounded px-1">GOOGLE_CLIENT_SECRET</code>.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {calStatus?.connected && (
                <button
                  onClick={handleTestCalendar}
                  disabled={calTesting}
                  className="text-sm border border-blue-200 text-blue-700 px-4 py-2 rounded-lg hover:bg-blue-50 disabled:opacity-50"
                >
                  {calTesting ? "Testing…" : "Test connection"}
                </button>
              )}
              {calStatus?.connected ? (
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="text-sm border border-red-200 text-red-600 px-4 py-2 rounded-lg hover:bg-red-50 disabled:opacity-50"
                >
                  {disconnecting ? "Disconnecting…" : "Disconnect"}
                </button>
              ) : (
                <p className="text-xs text-gray-500 self-center">
                  Sign in with Google to connect your calendar →{" "}
                  <a href="/login" className="text-blue-600 underline">
                    Sign in
                  </a>
                </p>
              )}
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-400 space-y-1">
            <p>
              <strong>Required scopes:</strong>{" "}
              <code className="bg-gray-50 px-1 rounded">openid email profile</code>{" "}
              <code className="bg-gray-50 px-1 rounded">calendar</code>{" "}
              <code className="bg-gray-50 px-1 rounded">calendar.events</code>
            </p>
            <p>
              Tokens are refreshed automatically. If a token expires, sign out and back in to
              renew calendar access.
            </p>
          </div>
        </section>

        {/* ── PayPal ───────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 mb-1">PayPal Payments</h2>
          <p className="text-sm text-gray-500 mb-4">
            Configure via server environment variables.
          </p>
          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ? "bg-green-500" : "bg-red-400"
                }`}
              />
              <span className="text-gray-600">
                NEXT_PUBLIC_PAYPAL_CLIENT_ID:{" "}
                {process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ? "✓ Set" : "⚠ Not set"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
              <span className="text-gray-600">
                PAYPAL_MODE:{" "}
                <span
                  className={
                    process.env.NEXT_PUBLIC_PAYPAL_MODE === "live"
                      ? "text-green-600 font-bold"
                      : "text-yellow-600"
                  }
                >
                  {process.env.NEXT_PUBLIC_PAYPAL_MODE ?? "sandbox"}
                </span>
              </span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Set{" "}
            <code className="bg-gray-100 rounded px-1">PAYPAL_WEBHOOK_ID</code> to enable
            server-side webhook signature verification at{" "}
            <code className="bg-gray-100 rounded px-1">/api/payments/webhook</code>.
          </p>
        </section>

      </div>
    </div>
  );
}
