import { describe, expect, it } from 'vitest';
import { generateInviteCode, generateToken, hashToken, safeEqual } from '../../src/utils/crypto.js';
import { toReactionGroups } from '../../src/utils/dto.js';

describe('crypto helpers', () => {
  it('generates unpredictable tokens', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it('hashes tokens deterministically and irreversibly', () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
    expect(hash).toHaveLength(64);
  });

  it('invite codes are url-safe and unique', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateInviteCode()));
    expect(codes.size).toBe(50);
    for (const c of codes) expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('safeEqual compares without leaking length mismatches', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('reaction grouping', () => {
  it('groups reactions per emoji with me flag', () => {
    const groups = toReactionGroups(
      [
        { emoji: '👍', userId: 'a' },
        { emoji: '👍', userId: 'b' },
        { emoji: '🎉', userId: 'me' },
      ],
      'me',
    );
    const thumbs = groups.find((g) => g.emoji === '👍')!;
    expect(thumbs.count).toBe(2);
    expect(thumbs.me).toBe(false);
    const party = groups.find((g) => g.emoji === '🎉')!;
    expect(party.me).toBe(true);
    expect(party.count).toBe(1);
  });
});
