import crypto from 'crypto';

const SCRYPT_KEY_LEN = 64;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface SessionInfo {
  token: string;
  userId: string;
  username: string;
  createdAt: number;
}

const activeSessions = new Map<string, SessionInfo>();

interface AttemptTracker {
  failures: number;
  lockedUntil: number;
}

const attemptTrackers = new Map<string, AttemptTracker>();

export function hashSecret(plainText: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plainText, salt, SCRYPT_KEY_LEN).toString('hex');
  return `${salt}:${derived}`;
}

export function verifySecret(plainText: string, storedHash: string): boolean {
  if (!plainText || !storedHash || !storedHash.includes(':')) {
    return false;
  }
  const [salt, originalHex] = storedHash.split(':');
  if (!salt || !originalHex) return false;

  try {
    const derived = crypto.scryptSync(plainText, salt, SCRYPT_KEY_LEN);
    const originalBuf = Buffer.from(originalHex, 'hex');
    if (derived.length !== originalBuf.length) return false;
    return crypto.timingSafeEqual(derived, originalBuf);
  } catch {
    return false;
  }
}

export function normalizeSecurityAnswer(answer: string): string {
  return String(answer || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function normalizeRecoveryKey(key: string): string {
  return String(key || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function generateRecoveryKey(): string {
  const bytes = crypto.randomBytes(12);
  let chars = '';
  for (let i = 0; i < 12; i++) {
    chars += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return `REC-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export function createSession(userId: string, username: string): SessionInfo {
  const token = crypto.randomBytes(32).toString('hex');
  const info: SessionInfo = {
    token,
    userId,
    username,
    createdAt: Date.now(),
  };
  activeSessions.set(token, info);
  return info;
}

export function getSessionFromToken(token?: string | null): SessionInfo | null {
  if (!token) return null;
  return activeSessions.get(token) || null;
}

export function extractBearerToken(authHeader?: string | string[]): string | null {
  if (!authHeader) return null;
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!raw || !raw.startsWith('Bearer ')) return null;
  const token = raw.slice(7).trim();
  return token || null;
}

export function getSessionFromHeader(authHeader?: string | string[]): SessionInfo | null {
  const token = extractBearerToken(authHeader);
  return getSessionFromToken(token);
}

export function revokeSession(token?: string | null): void {
  if (token) activeSessions.delete(token);
}

export function revokeAllSessions(): void {
  activeSessions.clear();
}

export function checkRateLimit(bucket: string): { allowed: boolean; waitSeconds: number } {
  const entry = attemptTrackers.get(bucket);
  if (!entry) return { allowed: true, waitSeconds: 0 };
  const now = Date.now();
  if (entry.lockedUntil > now) {
    return {
      allowed: false,
      waitSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
    };
  }
  return { allowed: true, waitSeconds: 0 };
}

export function recordFailedAttempt(bucket: string): void {
  const current = attemptTrackers.get(bucket) || { failures: 0, lockedUntil: 0 };
  const failures = current.failures + 1;
  const lockedUntil = failures >= 5 ? Date.now() + 30_000 : 0;
  attemptTrackers.set(bucket, { failures, lockedUntil });
}

export function clearFailedAttempts(bucket: string): void {
  attemptTrackers.delete(bucket);
}

export function sanitizeAvatarDataUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length > 400_000) return '';
  const safeImagePattern =
    /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
  return safeImagePattern.test(trimmed) ? trimmed : '';
}
