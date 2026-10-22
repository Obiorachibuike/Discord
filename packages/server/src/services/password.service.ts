import { hash, verify, Algorithm } from '@node-rs/argon2';

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
