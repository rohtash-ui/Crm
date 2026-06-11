import { google } from "googleapis";
import { prisma } from "./prisma";
import { isGoogleCalendarConfigured } from "./env";

// ─── OAuth2 client ────────────────────────────────────────────────────────────

function createOAuth2Client() {
  if (!isGoogleCalendarConfigured()) {
    throw new Error(
      "Google Calendar is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
    );
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    // redirect_uri is not needed for token-based operations
  );
}

/**
 * Build an authenticated OAuth2 client and automatically refresh the
 * access token when it has expired or is about to expire.
 * If a new access token is issued, it is persisted back to CalendarConnection.
 */
async function getAuthClient(userId: string) {
  const conn = await prisma.calendarConnection.findUnique({
    where: { userId_provider: { userId, provider: "google" } },
  });

  if (!conn) {
    throw new Error("Google Calendar not connected for this user.");
  }

  const oauth2 = createOAuth2Client();
  oauth2.setCredentials({
    access_token: conn.accessToken,
    refresh_token: conn.refreshToken ?? undefined,
    expiry_date: conn.expiresAt ? conn.expiresAt.getTime() : undefined,
  });

  // Proactively refresh if the token expires within 5 minutes
  const expiresAt = conn.expiresAt ? conn.expiresAt.getTime() : 0;
  const needsRefresh = !expiresAt || Date.now() > expiresAt - 5 * 60 * 1000;

  if (needsRefresh && conn.refreshToken) {
    try {
      const { credentials } = await oauth2.refreshAccessToken();
      const newAccessToken = credentials.access_token!;
      const newExpiry = credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : null;

      await prisma.calendarConnection.update({
        where: { userId_provider: { userId, provider: "google" } },
        data: {
          accessToken: newAccessToken,
          expiresAt: newExpiry,
          ...(credentials.refresh_token
            ? { refreshToken: credentials.refresh_token }
            : {}),
        },
      });

      oauth2.setCredentials({
        access_token: newAccessToken,
        refresh_token: credentials.refresh_token ?? conn.refreshToken ?? undefined,
        expiry_date: credentials.expiry_date ?? undefined,
      });
    } catch (err) {
      console.error("[Calendar] Token refresh failed:", err);
      // Continue with the existing token; the API call will fail naturally
      // if it's truly expired — the caller should handle that.
    }
  }

  return oauth2;
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export interface CalendarEventResult {
  id: string | null;
  hangoutLink: string | null;
  htmlLink: string | null;
}

/**
 * Create a Google Calendar event with a Google Meet link.
 * Adds the host as organizer and the guest as an attendee.
 */
export async function createCalendarEvent(
  userId: string,
  {
    summary,
    description,
    startTime,
    endTime,
    hostEmail,
    hostName,
    guestEmail,
    guestName,
    timezone = "UTC",
  }: {
    summary: string;
    description?: string;
    startTime: Date;
    endTime: Date;
    hostEmail: string;
    hostName: string;
    guestEmail: string;
    guestName: string;
    timezone?: string;
  }
): Promise<CalendarEventResult> {
  const auth = await getAuthClient(userId);
  const calendar = google.calendar({ version: "v3", auth });

  const response = await calendar.events.insert({
    calendarId: "primary",
    sendUpdates: "all",          // emails attendees automatically
    conferenceDataVersion: 1,    // required to generate Meet link
    requestBody: {
      summary,
      description: description
        ? `${description}\n\n---\nManaged by BookFlow`
        : "Managed by BookFlow",
      start: { dateTime: startTime.toISOString(), timeZone: timezone },
      end:   { dateTime: endTime.toISOString(),   timeZone: timezone },
      attendees: [
        { email: hostEmail,  displayName: hostName,  organizer: true, responseStatus: "accepted" },
        { email: guestEmail, displayName: guestName, responseStatus: "needsAction" },
      ],
      conferenceData: {
        createRequest: {
          requestId: `bookflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
      // Reminders: 24 h email + 15 min popup
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 24 * 60 },
          { method: "popup", minutes: 15 },
        ],
      },
    },
  });

  const event = response.data;
  return {
    id:          event.id         ?? null,
    hangoutLink: event.hangoutLink ?? null,
    htmlLink:    event.htmlLink    ?? null,
  };
}

/**
 * Delete a calendar event. Silently ignores 404 (already deleted).
 */
export async function deleteCalendarEvent(
  userId: string,
  calendarEventId: string
): Promise<void> {
  try {
    const auth = await getAuthClient(userId);
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.delete({
      calendarId: "primary",
      eventId: calendarEventId,
      sendUpdates: "all",
    });
  } catch (err: any) {
    if (err?.code === 404 || err?.status === 404) return;
    throw err;
  }
}

/**
 * Update start/end times of an existing calendar event.
 */
export async function updateCalendarEvent(
  userId: string,
  calendarEventId: string,
  {
    startTime,
    endTime,
    timezone = "UTC",
  }: {
    startTime: Date;
    endTime: Date;
    timezone?: string;
  }
): Promise<void> {
  const auth = await getAuthClient(userId);
  const calendar = google.calendar({ version: "v3", auth });

  await calendar.events.patch({
    calendarId: "primary",
    eventId: calendarEventId,
    sendUpdates: "all",
    requestBody: {
      start: { dateTime: startTime.toISOString(), timeZone: timezone },
      end:   { dateTime: endTime.toISOString(),   timeZone: timezone },
    },
  });
}

/**
 * Query Google Calendar FreeBusy API for a time window.
 * Returns busy periods as [{start, end}] or [] on error.
 */
export async function getFreeBusyTimes(
  userId: string,
  timeMin: Date,
  timeMax: Date
): Promise<Array<{ start: string; end: string }>> {
  try {
    const auth = await getAuthClient(userId);
    const calendar = google.calendar({ version: "v3", auth });

    const result = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: "primary" }],
      },
    });

    const busy = result.data.calendars?.primary?.busy ?? [];
    return busy
      .filter((b) => b.start && b.end)
      .map((b)   => ({ start: b.start!, end: b.end! }));
  } catch (err) {
    console.error("[Calendar] FreeBusy query failed:", err);
    return [];
  }
}

/**
 * Fetch the display name of the user's primary calendar.
 * Used only for UI display in settings.
 */
export async function getPrimaryCalendarInfo(
  userId: string
): Promise<{ summary: string; id: string } | null> {
  try {
    const auth = await getAuthClient(userId);
    const calendar = google.calendar({ version: "v3", auth });
    const res = await calendar.calendars.get({ calendarId: "primary" });
    return {
      summary: res.data.summary ?? "Primary Calendar",
      id:      res.data.id      ?? "primary",
    };
  } catch {
    return null;
  }
}

/**
 * Test whether the stored credentials can reach the Google Calendar API.
 * Returns true if the connection is valid, false otherwise.
 */
export async function testCalendarConnection(userId: string): Promise<boolean> {
  try {
    const info = await getPrimaryCalendarInfo(userId);
    return info !== null;
  } catch {
    return false;
  }
}
