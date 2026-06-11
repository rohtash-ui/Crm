import { google } from "googleapis";

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
  }: {
    summary: string;
    description?: string;
    startTime: Date;
    endTime: Date;
    attendeeEmail: string;
    attendeeName: string;
  }
) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const event = await calendar.events.insert({
    calendarId: "primary",
    sendUpdates: "all",
    requestBody: {
      summary,
      description,
      start: { dateTime: startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
      attendees: [{ email: attendeeEmail, displayName: attendeeName }],
      conferenceData: {
        createRequest: {
          requestId: `bookflow-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
    conferenceDataVersion: 1,
  });

  return event.data;
}

export async function getAvailableSlots(
  accessToken: string,
  refreshToken: string,
  date: Date,
  duration: number
) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const busyTimes = await calendar.freebusy.query({
    requestBody: {
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      items: [{ id: "primary" }],
    },
  });

  return busyTimes.data.calendars?.primary?.busy || [];
}
