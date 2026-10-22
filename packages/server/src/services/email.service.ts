import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transport: nodemailer.Transporter | null = null;

function getTransport(): nodemailer.Transporter | null {
  if (config.EMAIL_PROVIDER === 'none') return null;
  if (config.EMAIL_PROVIDER === 'console') return null;
  if (!transport && config.SMTP_URL) {
    transport = nodemailer.createTransport(config.SMTP_URL);
  }
  return transport;
}

/**
 * Sends an email through the configured provider.
 * - `smtp`: real delivery via SMTP_URL.
 * - `console`: logs the message body (development convenience; the email is
 *   NOT delivered anywhere).
 * - `none`: silently skips (tests).
 */
export async function sendEmail(mail: Mail): Promise<void> {
  const t = getTransport();
  if (t) {
    await t.sendMail({ from: config.EMAIL_FROM, ...mail });
    logger.info({ to: mail.to, subject: mail.subject }, 'email sent');
    return;
  }
  if (config.EMAIL_PROVIDER === 'console') {
    logger.info(
      { to: mail.to, subject: mail.subject, preview: mail.text.slice(0, 200) },
      'email console transport (not delivered)',
    );
  }
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const link = `${config.WEB_URL}/verify?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to,
    subject: 'Verify your Aether account',
    text: `Welcome to Aether! Verify your email by opening: ${link}\nThis link expires in 24 hours.`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${config.WEB_URL}/reset?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to,
    subject: 'Reset your Aether password',
    text: `Reset your password by opening: ${link}\nIf you did not request this, you can ignore this email. The link expires in 1 hour.`,
  });
}

export async function sendInviteEmail(to: string, inviterName: string, code: string): Promise<void> {
  const link = `${config.WEB_URL}/invite/${encodeURIComponent(code)}`;
  await sendEmail({
    to,
    subject: `${inviterName} invited you to a community on Aether`,
    text: `${inviterName} invited you to join their community on Aether: ${link}`,
  });
}
