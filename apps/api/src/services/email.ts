import nodemailer from 'nodemailer';
import { config } from '../lib/config';
import { HttpError } from '../lib/errors';

export const emailReady = !!(config.SMTP_HOST && config.EMAIL_FROM);
export async function sendEmail(to: string, subject: string, text: string) {
  if (!emailReady) throw new HttpError(503, 'EMAIL_UNAVAILABLE', 'Email delivery is not configured.');
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST, port: config.SMTP_PORT ?? 587, secure: (config.SMTP_PORT ?? 587) === 465,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' } : undefined
  });
  await transport.sendMail({ from: config.EMAIL_FROM, to, subject, text });
}
