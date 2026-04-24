import crypto from 'crypto';
import { google } from 'googleapis';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const ENC_KEY_HEX = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export function assertGoogleEnv() {
  if (!CLIENT_ID) throw new Error('Missing env: GOOGLE_CLIENT_ID');
  if (!CLIENT_SECRET) throw new Error('Missing env: GOOGLE_CLIENT_SECRET');
  if (!REDIRECT_URI) throw new Error('Missing env: GOOGLE_REDIRECT_URI');
  if (!ENC_KEY_HEX) throw new Error('Missing env: GMAIL_TOKEN_ENCRYPTION_KEY');
}

export function getOAuthClient() {
  assertGoogleEnv();
  return new google.auth.OAuth2(CLIENT_ID!, CLIENT_SECRET!, REDIRECT_URI!);
}

function getEncKey(): Buffer {
  assertGoogleEnv();
  const buf = Buffer.from(ENC_KEY_HEX!, 'hex');
  if (buf.length !== 32) {
    throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  }
  return buf;
}

export function encryptToken(plaintext: string): string {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptToken(payload: string): string {
  const key = getEncKey();
  const [ivHex, tagHex, ctHex] = payload.split(':');
  if (!ivHex || !tagHex || !ctHex) throw new Error('Invalid encrypted token format');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

export function signState(userId: string, ttlSeconds = 600): string {
  const key = getEncKey();
  const payload = { u: userId, n: crypto.randomBytes(8).toString('hex'), e: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyState(state: string): { userId: string } | null {
  try {
    const key = getEncKey();
    const [body, sig] = state.split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', key).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.u || typeof payload.u !== 'string') return null;
    if (typeof payload.e !== 'number' || payload.e < Math.floor(Date.now() / 1000)) return null;
    return { userId: payload.u };
  } catch {
    return null;
  }
}
