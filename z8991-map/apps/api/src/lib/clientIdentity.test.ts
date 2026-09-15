import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clientKeyFromRequest,
  normalizeClientId,
  trustedClientIp,
} from './clientIdentity.js';

describe('clientIdentity', () => {
  it('normalizes client id', () => {
    assert.equal(normalizeClientId('abc'), null);
    assert.equal(normalizeClientId('abcdefgh'), 'abcdefgh');
    assert.equal(normalizeClientId('  ab-cd_EF12  '), 'ab-cd_EF12');
    assert.equal(normalizeClientId('bad id!!'), null);
  });

  it('prefers X-Real-IP over leftmost X-Forwarded-For', () => {
    const ip = trustedClientIp((n) => {
      if (n === 'x-real-ip') return '10.0.0.8';
      if (n === 'x-forwarded-for') return '1.2.3.4, 10.0.0.8';
      return undefined;
    });
    assert.equal(ip, '10.0.0.8');
  });

  it('uses rightmost XFF hop when no X-Real-IP', () => {
    const ip = trustedClientIp((n) => {
      if (n === 'x-forwarded-for') return 'spoofed, 203.0.113.9';
      return undefined;
    });
    assert.equal(ip, '203.0.113.9');
  });

  it('clientKey prefers X-Client-Id over IP', () => {
    const key = clientKeyFromRequest((n) => {
      if (n === 'x-client-id') return 'browserid01234567';
      if (n === 'x-real-ip') return '10.0.0.1';
      return undefined;
    });
    assert.equal(key, 'cid:browserid01234567');
  });

  it('clientKey falls back to trusted IP', () => {
    const key = clientKeyFromRequest((n) => {
      if (n === 'x-real-ip') return '10.0.0.2';
      return undefined;
    });
    assert.equal(key, 'ip:10.0.0.2');
  });
});
