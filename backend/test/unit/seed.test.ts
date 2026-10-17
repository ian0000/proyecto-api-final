import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPassword } from '../../src/auth.js';
const doubles = vi.hoisted(() => ({ updateOne: vi.fn(), connect: vi.fn(), close: vi.fn() }));
vi.mock('../../src/store.js', () => ({
  Store: class {
    users = { updateOne: doubles.updateOne };
    connect = doubles.connect;
    close = doubles.close;
  },
}));
import { seed } from '../../src/seed.js';
import type { Store } from '../../src/store.js';
const password = 'fictional-unit-password';
const originalArgv = [...process.argv];
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe('Academic users seed without database', () => {
  it('refuses weak passwords before writing anything', async () => {
    await expect(
      seed({ users: { updateOne: doubles.updateOne } } as unknown as Store, 'short'),
    ).rejects.toThrow('at least 12');
    expect(doubles.updateOne).not.toHaveBeenCalled();
  });
  it('inserts the three roles once, stores salted hashes and preserves existing users', async () => {
    await seed({ users: { updateOne: doubles.updateOne } } as unknown as Store, password);
    expect(doubles.updateOne).toHaveBeenCalledTimes(3);
    for (const [index, role] of ['asesor', 'supervisor', 'administrador'].entries()) {
      const [filter, update, options] = doubles.updateOne.mock.calls[index];
      expect(filter).toEqual({ _id: `demo-${role}` });
      expect(options).toEqual({ upsert: true });
      expect(Object.keys(update)).toEqual(['$setOnInsert']);
      expect(update.$setOnInsert).toMatchObject({
        role,
        agency: role === 'administrador' ? 'central' : 'agencia-quito',
        email: `${role}@demo.test`,
      });
      expect(update.$setOnInsert.passwordHash).not.toBe(password);
      expect(checkPassword(password, update.$setOnInsert.passwordHash)).toBe(true);
    }
  });
  it('CLI connects and always closes its owned connection on failure', async () => {
    vi.resetModules();
    process.argv = ['node', 'seed.ts'];
    for (const name of ['JWT_SECRET', 'WEBHOOK_SECRET', 'MOCK_SECRET'])
      vi.stubEnv(name, 'unit-only-secret'.repeat(3));
    vi.stubEnv('DEMO_PASSWORD', password);
    doubles.updateOne.mockRejectedValueOnce(new Error('write failed'));
    await expect(import('../../src/seed.js')).rejects.toThrow('write failed');
    expect(doubles.connect).toHaveBeenCalledOnce();
    expect(doubles.close).toHaveBeenCalledOnce();
  });
  it('CLI requires an explicit password and emits no credential', async () => {
    vi.resetModules();
    process.argv = ['node', 'seed.ts'];
    for (const name of ['JWT_SECRET', 'WEBHOOK_SECRET', 'MOCK_SECRET'])
      vi.stubEnv(name, 'unit-only-secret'.repeat(3));
    vi.stubEnv('DEMO_PASSWORD', undefined);
    await expect(import('../../src/seed.js')).rejects.toThrow('DEMO_PASSWORD required');
    expect(doubles.connect).not.toHaveBeenCalled();
  });
  it('CLI seeds successfully, closes its connection and logs only a neutral confirmation', async () => {
    vi.resetModules();
    process.argv = ['node', 'seed.ts'];
    for (const name of ['JWT_SECRET', 'WEBHOOK_SECRET', 'MOCK_SECRET'])
      vi.stubEnv(name, 'unit-only-secret'.repeat(3));
    vi.stubEnv('DEMO_PASSWORD', password);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../../src/seed.js');
    expect(doubles.updateOne).toHaveBeenCalledTimes(3);
    expect(doubles.close).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0][0])).not.toContain(password);
  });
});
