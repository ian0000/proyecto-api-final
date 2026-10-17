import { describe, it, expect } from 'vitest';
import { hashPassword, checkPassword } from '../src/auth.js';
import { config } from '../src/config.js';
import { signWebhook, verifyWebhook } from '../../shared/security.js';
import { routeSchema, expand } from '../src/contract.js';
describe('Security and configuration', () => {
  it('hashes with unique salts and rejects altered passwords', () => {
    const a = hashPassword('fictional-password');
    expect(a).not.toBe(hashPassword('fictional-password'));
    expect(checkPassword('fictional-password', a)).toBe(true);
    expect(checkPassword('wrong', a)).toBe(false);
    expect(checkPassword('wrong', 'bad')).toBe(false);
  });
  it('validates signatures, tampering, time window and malformed signatures', () => {
    const t = String(Date.now());
    const raw = '{"accepted":true}';
    const sig = signWebhook('secret', t, raw);
    expect(verifyWebhook('secret', t, raw, sig)).toBe(true);
    expect(verifyWebhook('secret', t, raw + ' ', sig)).toBe(false);
    expect(verifyWebhook('secret', t, raw, sig, Date.now() + 301000)).toBe(false);
    expect(verifyWebhook('secret', 'invalid', raw, sig)).toBe(false);
    expect(verifyWebhook('secret', t, raw, 'wrong')).toBe(false);
  });
  it('requires strong configured secrets and positive numeric settings', () => {
    expect(() => config({})).toThrow('JWT_SECRET');
    const env = {
      JWT_SECRET: 'j'.repeat(40),
      MOCK_SECRET: 'm'.repeat(40),
      WEBHOOK_SECRET: 'w'.repeat(40),
    };
    expect(config(env).port).toBe(4000);
    expect(() => config({ ...env, PORT: '-1' })).toThrow('PORT');
    expect(
      config({ ...env, PORT: '4500', CORS_ORIGINS: 'https://demo.test', LOG_LEVEL: 'silent' }).log,
    ).toBe(false);
  });
  it('rejects route definitions missing from the source contract', () => {
    expect(() => routeSchema('/missing', 'POST')).toThrow('Contract missing');
    expect(expand({ a: [1, null, { type: 'string' }] })).toEqual({
      a: [1, null, { type: 'string' }],
    });
  });
});
