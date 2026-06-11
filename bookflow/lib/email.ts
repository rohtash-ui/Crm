import nodemailer from "nodemailer";
import { format } from "date-fns";
import { isEmailConfigured } from "./env";

function getTransporter() {
  if (!isEmailConfigured()) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function formatTime(date: Date) {
  return format(date, "h:mm a");
}

function formatDate(date: Date) {
  return format(date, "EEEE, MMMM d, yyyy");
}

function baseTemplate(content: string) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#fff;">
      <div style="background:#2563EB;padding:24px 32px;">
        <h1 style="color:white;margin:0;font-size:22px;font-weight:700;letter-spacing:-0.5px;">BookFlow</h1>
      </div>
      <div style="padding:32px;background:#f9fafb;">
        ${content}
      </div>
      <div style="padding:16px 32px;background:#F3F4F6;text-align:center;border-top:1px solid #E5E7EB;">
        <p style="color:#9CA3AF;font-size:12px;margin:0;">Powered by BookFlow · You're receiving this because a booking was made.</p>
      </div>
    </div>
  `;
}

function bookingCard({
  eventTitle,
  hostName,
  guestName,
  dateStr,
  timeStr,
  location,
  meetLink,
  notes,
  amount,
  currency,
}: {
  eventTitle: string;
  hostName: string;
  guestName: string;
  dateStr: string;
  timeStr: string;
  location?: string;
  meetLink?: string;
  notes?: string;
  amount?: number;
  currency?: string;
}) {
  const rows = [
    ["Event", eventTitle],
    ["Host", hostName],
    ["Guest", guestName],
    ["Date", dateStr],
    ["Time", timeStr],
    location ? ["Location", location] : null,
    meetLink ? ["Meeting Link", `<a href="${meetLink}" style="color:#2563EB;">${meetLink}</a>`] : null,
    amount ? ["Amount Paid", `${amount.toFixed(2)} ${currency || "USD"}`] : null,
    notes ? ["Notes", notes] : null,
  ].filter(Boolean) as [string, string][];

  return `
    <div style="background:white;border-radius:10px;padding:24px;border:1px solid #E5E7EB;margin:20px 0;">
      <table style="width:100%;border-collapse:collapse;">
        ${rows
          .map(
            ([label, value]) => `
          <tr>
            <td style="color:#6B7280;padding:8px 0;font-size:14px;width:120px;vertical-align:top;">${label}</td>
            <td style="color:#111827;padding:8px 0;font-size:14px;font-weight:500;">${value}</td>
          </tr>
        `
          )
          .join("")}
      </table>
    </div>
  `;
}

async function sendMail(options: nodemailer.SendMailOptions) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("[Email] SMTP not configured — skipping email:", options.subject);
    return;
  }
  await transporter.sendMail({
    from: process.env.SMTP_FROM || `BookFlow <${process.env.SMTP_USER}>`,
    ...options,
  });
}

export async function sendBookingConfirmation({
  guestEmail,
  guestName,
  hostName,
  eventTitle,
  startTime,
  endTime,
  location,
  meetLink,
  notes,
  amount,
  currency,
}: {
  guestEmail: string;
  guestName: string;
  hostName: string;
  eventTitle: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  meetLink?: string;
  notes?: string;
  amount?: number;
  currency?: string;
}) {
  const card = bookingCard({
    eventTitle,
    hostName,
    guestName,
    dateStr: formatDate(startTime),
    timeStr: `${formatTime(startTime)} – ${formatTime(endTime)}`,
    location,
    meetLink,
    notes,
    amount,
    currency,
  });

  await sendMail({
    to: guestEmail,
    subject: `Confirmed: ${eventTitle} with ${hostName}`,
    html: baseTemplate(`
      <div style="margin-bottom:8px;">
        <span style="background:#D1FAE5;color:#065F46;font-size:13px;font-weight:600;padding:4px 10px;border-radius:20px;">✓ Booking Confirmed</span>
      </div>
      <h2 style="color:#111827;margin:16px 0 4px;font-size:20px;">You're all set, ${guestName}!</h2>
      <p style="color:#6B7280;margin:0 0 8px;font-size:15px;">Your booking has been confirmed. Here are the details:</p>
      ${card}
      ${meetLink ? `<p style="color:#6B7280;font-size:13px;margin-top:8px;">💡 A calendar invite has been sent with a Google Meet link.</p>` : ""}
    `),
  });
}

export async function sendHostNotification({
  hostEmail,
  hostName,
  guestName,
  guestEmail,
  guestPhone,
  eventTitle,
  startTime,
  endTime,
  notes,
  amount,
  currency,
}: {
  hostEmail: string;
  hostName: string;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  eventTitle: string;
  startTime: Date;
  endTime: Date;
  notes?: string;
  amount?: number;
  currency?: string;
}) {
  const card = bookingCard({
    eventTitle,
    hostName,
    guestName,
    dateStr: formatDate(startTime),
    timeStr: `${formatTime(startTime)} – ${formatTime(endTime)}`,
    notes,
    amount,
    currency,
  });

  const contactInfo = guestPhone
    ? `<p style="color:#374151;font-size:14px;margin-top:4px;">📧 ${guestEmail} · 📱 ${guestPhone}</p>`
    : `<p style="color:#374151;font-size:14px;margin-top:4px;">📧 ${guestEmail}</p>`;

  await sendMail({
    to: hostEmail,
    subject: `New booking: ${guestName} booked ${eventTitle}`,
    html: baseTemplate(`
      <h2 style="color:#111827;margin:0 0 4px;font-size:20px;">New booking received!</h2>
      <p style="color:#6B7280;margin:0 0 8px;font-size:15px;">Hi ${hostName}, someone just booked with you.</p>
      ${card}
      ${contactInfo}
    `),
  });
}

export async function sendCancellationEmail({
  guestEmail,
  guestName,
  hostName,
  eventTitle,
  startTime,
  cancelReason,
}: {
  guestEmail: string;
  guestName: string;
  hostName: string;
  eventTitle: string;
  startTime: Date;
  cancelReason?: string;
}) {
  await sendMail({
    to: guestEmail,
    subject: `Booking Cancelled: ${eventTitle}`,
    html: baseTemplate(`
      <div style="margin-bottom:8px;">
        <span style="background:#FEE2E2;color:#991B1B;font-size:13px;font-weight:600;padding:4px 10px;border-radius:20px;">Booking Cancelled</span>
      </div>
      <h2 style="color:#111827;margin:16px 0 4px;font-size:20px;">Your booking has been cancelled</h2>
      <p style="color:#6B7280;font-size:15px;margin:0 0 16px;">Hi ${guestName}, your booking for <strong>${eventTitle}</strong> with ${hostName} on ${formatDate(startTime)} at ${formatTime(startTime)} has been cancelled.</p>
      ${cancelReason ? `<div style="background:white;border-radius:10px;padding:16px;border:1px solid #E5E7EB;"><p style="color:#374151;font-size:14px;margin:0;"><strong>Reason:</strong> ${cancelReason}</p></div>` : ""}
      <p style="color:#6B7280;font-size:14px;margin-top:16px;">If you have questions, please contact ${hostName} directly.</p>
    `),
  });
}

export async function sendRescheduleEmail({
  guestEmail,
  guestName,
  hostName,
  eventTitle,
  oldStartTime,
  newStartTime,
  newEndTime,
  location,
  meetLink,
}: {
  guestEmail: string;
  guestName: string;
  hostName: string;
  eventTitle: string;
  oldStartTime: Date;
  newStartTime: Date;
  newEndTime: Date;
  location?: string;
  meetLink?: string;
}) {
  const card = bookingCard({
    eventTitle,
    hostName,
    guestName,
    dateStr: formatDate(newStartTime),
    timeStr: `${formatTime(newStartTime)} – ${formatTime(newEndTime)}`,
    location,
    meetLink,
  });

  await sendMail({
    to: guestEmail,
    subject: `Rescheduled: ${eventTitle} with ${hostName}`,
    html: baseTemplate(`
      <div style="margin-bottom:8px;">
        <span style="background:#DBEAFE;color:#1E40AF;font-size:13px;font-weight:600;padding:4px 10px;border-radius:20px;">Booking Rescheduled</span>
      </div>
      <h2 style="color:#111827;margin:16px 0 4px;font-size:20px;">Your booking has been rescheduled</h2>
      <p style="color:#6B7280;font-size:15px;margin:0 0 4px;">Previously scheduled for <strong>${formatDate(oldStartTime)} at ${formatTime(oldStartTime)}</strong>.</p>
      <p style="color:#6B7280;font-size:15px;margin:0 0 16px;">New time:</p>
      ${card}
    `),
  });
}
