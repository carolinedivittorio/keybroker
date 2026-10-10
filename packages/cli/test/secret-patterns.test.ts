import { describe, expect, it } from 'vitest';
import { findLikelySecret } from '../src/secret-patterns.js';

describe('findLikelySecret', () => {
  it.each([
    ['here is my key sk_0123456789abcdef0123456789abcdef0123456789abcdef'],
    ['OPENAI_API_KEY=sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345'],
    ['token ghp_0123456789abcdefghijABCDEFGHIJ0123456789'],
    ['aws AKIAIOSFODNN7EXAMPLE please'],
    ['my api key is: Zq8Lw2Pn4Rt6Vy0Xb3Kd5Mf7Hg9Js1Ac'],
  ])('flags %s', (text) => expect(findLikelySecret(text)).toBeDefined());

  it.each([
    ['fix the bug in commit 3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39'],
    ['the request id is 123e4567-e89b-12d3-a456-426614174000'],
    ['set ELEVENLABS_API_KEY to the placeholder keybroker-managed:elevenlabs'],
    ['use the sk_ prefix check in secret-patterns.ts'],
    ['how do I rotate my token?'],
  ])('ignores %s', (text) => expect(findLikelySecret(text)).toBeUndefined());
});
