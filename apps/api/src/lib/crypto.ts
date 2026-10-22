import crypto from 'node:crypto';
export const randomToken = () => crypto.randomBytes(32).toString('hex');
export const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const safeEqual = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const pairKey = (a: string, b: string) => [a, b].sort().join(':');
