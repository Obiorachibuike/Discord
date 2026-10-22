import argon2 from 'argon2';
// This is the hash of a non-account dummy string, used to equalize unknown-user login timing.
const dummyHash = '$argon2id$v=19$m=65536,t=3,p=1$RFcsdR0Ci4HH7M0QuhDFfw$rs8c+CibrsE0YWefbwnCxISAosWRB0gwzGWXKcHchQk';
export function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
}
export async function verifyPassword(passwordHash: string | null | undefined, password: string) {
  const match = await argon2.verify(passwordHash ?? dummyHash, password).catch(() => false);
  return !!passwordHash && match;
}
