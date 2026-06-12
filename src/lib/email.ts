import nodemailer from 'nodemailer';
import { sendEmailViaUserGmail } from '@/lib/gmailSend';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_ADDRESS = process.env.EMAIL_FROM || 'no-reply@example.com';

async function sendViaGmailFallback(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  reason: string;
}) {
  const gmailUserId =
    process.env.PASSWORD_RESET_EMAIL_USER_ID ||
    process.env.GHOST_USER_ID ||
    process.env.DEVELOPER_USER_ID;

  if (!gmailUserId) {
    throw new Error(`${params.reason} Configure SMTP ou PASSWORD_RESET_EMAIL_USER_ID.`);
  }

  const result = await sendEmailViaUserGmail(gmailUserId, {
    to: [params.to],
    subject: params.subject,
    bodyText: params.text || '',
    bodyHtml: params.html,
  });

  if (!result.ok) {
    throw new Error(`Falha ao enviar email pelo Gmail: ${result.error}`);
  }

  return result;
}

export async function sendEmail(to: string, subject: string, html: string, text?: string) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return sendViaGmailFallback({
      to,
      subject,
      html,
      text,
      reason: 'SMTP nao configurado.',
    });
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  try {
    const info = await transporter.sendMail({
      from: FROM_ADDRESS,
      to,
      subject,
      text: text || undefined,
      html,
    });

    return info;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Falha no SMTP.';
    return sendViaGmailFallback({ to, subject, html, text, reason });
  }
}
