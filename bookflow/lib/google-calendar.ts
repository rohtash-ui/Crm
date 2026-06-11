import { google } from "googleapis";
import { isGoogleCalendarConfigured } from "./env";

function buildOAuth2Client(accessToken: string, refreshToken?: string) {
  if (!isGoogleCalendarConfigured()) {
    throw new Error("Google Calendar is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  return oauth2Client;
}

export async function createCalendarEvent(
  accessToken: string,
  refreshToken: string,
  {
    summary,
    description,
    startTime,
    endTime,
    attendeeEmail,
    attendeeName,
    timezone = "UTC",
  }: {
    summary: string;
    description?: string;
    startTime: Date;
    endTime: Date;
    attendeeEmail: string;
    attendeeName: string;
    timezone?: string;
  }
) {
  const auth = buildOAuth2Client(accessToken, refreshToken);
  const calendar = google.calendar({ version: "v3", auth });

  const event = await calendar.events.insert({
    calendarId: "primary",
    sendUpdates: "all",
    conferenceDataVersion: 1,
    requestBody: {
      summary,
      description,
      start: { dateTime: startTime.toISOString(), timeZone: timezone },
      end: { dateTime: endTime.toISOString(), timeZone: timezone },
      attendees: [{ email: attendeeEmail, displayName: attendeeName }],
      conferenceData: {
        createRequest: {
          requestId: `bookflow-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });

  return event.data;
}

export async function deleteCalendarEvent(
  accessToken: string,
  refreshToken: string,
  calendarEventId: string
) {
  try {
    const auth = buildOAuth2Client(accessToken, refreshToken);
    const calendar = google.calendar({ version: "v3", auth });

    await calendar.events.delete({
      calendarId: "primary",
      eventId: calendarEventId,
      sendUpdates: "all",
    });
  } catch (err: any) {
    // 404 means event was already deleted — treat as success
    if (err?.code !== 404) throw err;
  }
}

export async function updateCalendarEvent(
  accessToken: string,
  refreshToken: string,
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
) {
  const auth = buildOAuth2Client(accessToken, refreshToken);
  const calendar = google.calendar({ version: "v3", auth });

  const event = await calendar.events.patch({
    calendarId: "primary",
    eventId: calendarEventId,
    sendUpdates: "all",
    requestBody: {
      start: { dateTime: startTime.toISOString(), timeZone: timezone },
      end: { dateTime: endTime.toISOString(), timeZone: timezone },
    },
  });

  return event.data;
}

export async function getFreeBusyTimes(
  accessToken: string,
  refreshToken: string,
  timeMin: Date,
  timeMax: Date
): Promise<Array<{ start: string; end: string }>> {
  try {
    const auth = buildOAuth2Client(accessToken, refreshToken);
    const calendar = google.calendar({ version: "v3", auth });

    const result = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: "primary" }],
      },
    });

    const busy = result.data.calendars?.primary?.busy || [];
    return busy
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: b.start!, end: b.end! }));
  } catch {
    return [];
  }
}
