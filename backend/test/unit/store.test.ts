import { beforeEach, describe, expect, it, vi } from 'vitest';
const doubles = vi.hoisted(() => ({
  constructor: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  collection: vi.fn(),
  db: vi.fn(),
  applications: { createIndex: vi.fn() },
  users: { createIndex: vi.fn() },
  circuits: { createIndex: vi.fn() },
}));
vi.mock('mongodb', () => ({
  MongoClient: class {
    constructor(...args: unknown[]) {
      doubles.constructor(...args);
    }
    db(...args: unknown[]) {
      doubles.db(...args);
      return {
        collection: (name: 'applications' | 'users' | 'circuits') => {
          doubles.collection(name);
          return doubles[name];
        },
      };
    }
    connect() {
      return doubles.connect();
    }
    close() {
      return doubles.close();
    }
  },
}));
import { Store } from '../../src/store.js';
beforeEach(() => vi.clearAllMocks());
describe('Mongo store lifecycle with driver double', () => {
  it('selects an explicit database and semantic collections without contacting MongoDB', () => {
    const store = new Store('mongodb://unused:1', 'isolated_unit');
    expect(doubles.constructor).toHaveBeenCalledWith('mongodb://unused:1', {
      serverSelectionTimeoutMS: 5000,
    });
    expect(doubles.db).toHaveBeenCalledWith('isolated_unit');
    expect(doubles.collection.mock.calls.map((c) => c[0])).toEqual([
      'applications',
      'users',
      'circuits',
    ]);
    expect(store.applications).toBe(doubles.applications);
    expect(store.users).toBe(doubles.users);
    expect(store.circuits).toBe(doubles.circuits);
    expect(doubles.connect).not.toHaveBeenCalled();
  });
  it('connects, installs uniqueness and queue indexes, and closes the driver', async () => {
    const store = new Store('mongodb://unused:1', 'unit');
    await store.connect();
    expect(doubles.connect).toHaveBeenCalledOnce();
    expect(doubles.applications.createIndex).toHaveBeenCalledWith(
      { owner: 1, idempotencyKey: 1 },
      { unique: true },
    );
    expect(doubles.users.createIndex).toHaveBeenCalledWith({ email: 1 }, { unique: true });
    expect(doubles.applications.createIndex).toHaveBeenCalledWith({
      agency: 1,
      createdAt: -1,
      _id: -1,
    });
    expect(doubles.applications.createIndex).toHaveBeenCalledWith({ state: 1, createdAt: -1 });
    for (const bank of ['pichincha', 'pacifico'])
      expect(doubles.applications.createIndex).toHaveBeenCalledWith({
        [`submissions.${bank}.job.state`]: 1,
        [`submissions.${bank}.job.dueAt`]: 1,
      });
    await store.close();
    expect(doubles.close).toHaveBeenCalledOnce();
  });
  it('does not continue indexing after a failed connection', async () => {
    doubles.connect.mockRejectedValueOnce(new Error('connection unavailable'));
    await expect(new Store('mongodb://unused:1', 'unit').connect()).rejects.toThrow(
      'connection unavailable',
    );
    expect(doubles.applications.createIndex).not.toHaveBeenCalled();
  });
});
