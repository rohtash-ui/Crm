import nodemailer from "nodemailer";
import { format } from "date-fns";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendBookingConfirmation({
  guestEmail,
  guestName,
  hostName,
  eventTitle,
  startTime,
  endTime,
  location,
  meetLink,
}: {
  guestEmail: string;
  guestName: string;
  hostName: string;
  eventTitle: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  meetLink?: string;
}) {
  const dateStr = format(startTime, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(startTime, "h:mm a")} - ${format(endTime, "h:mm a")}`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: guestEmail,
    subject: `Booking Confirmed: ${eventTitle} with ${hostName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #3B82F6; padding: 24px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">BookFlow</h1>
        </div>
        <div style="padding: 32px; background: #f9fafb;">
          <h2 style="color: #111827;">Your booking is confirmed!</h2>
          <p style="color: #6B7280;">Hi ${guestName},</p>
          <p style="color: #6B7280;">Your booking has been confirmed. Here are the details:</p>

          <div style="background: white; border-radius: 8px; padding: 24px; margin: 24px 0; border: 1px solid #E5E7EB;">
            <table style="width: 100%;">
              <tr>
                <td style="color: #6B7280; padding: 8px 0;">Event</td>
                <td style="color: #111827; font-weight: 600; padding: 8px 0;">${eventTitle}</td>
              </tr>
              <tr>
                <td style="color: #6B7280; padding: 8px 0;">Host</td>
                <td style="color: #111827; padding: 8px 0;">${hostName}</td>
              </tr>
              <tr>
                <td style="color: #6B7280; padding: 8px 0;">Date</td>
                <td style="color: #111827; padding: 8px 0;">${dateStr}</td>
              </tr>
              <tr>
                <td style="color: #6B7280; padding: 8px 0;">Time</td>
                <td style="color: #111827; padding: 8px 0;">${timeStr}</td>
              </tr>
              ${location ? `<tr><td style="color: #6B7280; padding: 8px 0;">Location</td><td style="color: #111827; padding: 8px 0;">${location}</td></tr>` : ""}
              ${meetLink ? `<tr><td style="color: #6B7280; padding: 8px 0;">Meeting Link</td><td style="padding: 8px 0;"><a href="${meetLink}" style="color: #3B82F6;">${meetLink}</a></td></tr>` : ""}
            </table>
          </div>

          <p style="color: #6B7280; font-size: 14px;">A calendar invitation has been sent to your email address.</p>
        </div>
        <div style="padding: 16px; text-align: center; background: #F3F4F6;">
          <p style="color: #9CA3AF; font-size: 12px; margin: 0;">Powered by BookFlow</p>
        </div>
      </div>
    `,
  });
}

export async function sendHostNotification({
  hostEmail,
  hostName,
  guestName,
  guestEmail,
  eventTitle,
  startTime,
  endTime,
  notes,
}: {
  hostEmail: string;
  hostName: string;
  guestName: string;
  guestEmail: string;
  eventTitle: string;
  startTime: Date;
  endTime: Date;
  notes?: string;
}) {
  const dateStr = format(startTime, "EEEE, MMMM d, yyyy");
  const timeStr = `${format(startTime, "h:mm a")} - ${format(endTime, "h:mm a")}`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: hostEmail,
    subject: `New Booking: ${guestName} booked ${eventTitle}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #3B82F6; padding: 24px; text-align: center;">
          <h1 style="color: white; margin: 0;">BookFlow</h1>
        </div>
        <div style="padding: 32px; background: #f9fafb;">
          <h2>New booking received!</h2>
          <p>Hi ${hostName}, you have a new booking:</p>
          <div style="background: white; border-radius: 8px; padding: 24px; margin: 24px 0; border: 1px solid #E5E7EB;">
            <table style="width: 100%;">
              <tr><td style="color: #6B7280;">Guest</td><td style="font-weight: 600;">${guestName}</td></tr>
              <tr><td style="color: #6B7280;">Email</td><td>${guestEmail}</td></tr>
              <tr><td style="color: #6B7280;">Event</td><td>${eventTitle}</td></tr>
              <tr><td style="color: #6B7280;">Date</td><td>${dateStr}</td></tr>
              <tr><td style="color: #6B7280;">Time</td><td>${timeStr}</td></tr>
              ${notes ? `<tr><td style="color: #6B7280;">Notes</td><td>${notes}</td></tr>` : ""}
            </table>
          </div>
        </div>
      </div>
    `,
  });
}
