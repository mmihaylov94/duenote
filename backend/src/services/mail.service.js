import nodemailer from "nodemailer";
import { config } from "../config.js";

let cachedTransport = null;

function getTransport() {
  if (!config.smtpHost) return null;
  if (cachedTransport) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth:
      config.smtpUser || config.smtpPass
        ? { user: config.smtpUser || undefined, pass: config.smtpPass || undefined }
        : undefined,
  });
  return cachedTransport;
}

/**
 * Sends a one-time login code. If SMTP is not configured, logs the code in development.
 * @throws {Error} in production when SMTP is not configured
 */
export async function sendOtpEmail(to, code) {
  const transport = getTransport();
  if (!transport) {
    if (config.isProd) {
      throw new Error("SMTP is not configured; cannot send login codes in production.");
    }
    console.log(`[DueNote] Dev OTP for ${to}: ${code}`);
    return;
  }
  await transport.sendMail({
    from: config.smtpFrom,
    to,
    subject: "Your DueNote sign-in code",
    text: `Your sign-in code is: ${code}\n\nIt expires in 10 minutes. If you did not request this, you can ignore this email.`,
    html: `<p>Your sign-in code is:</p><p style="font-size:1.25rem;font-weight:600;letter-spacing:0.2em">${code}</p><p>This code expires in 10 minutes.</p>`,
  });
}
