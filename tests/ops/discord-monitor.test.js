import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  services,
  webhookUrl,
  parseSnapshot,
  collectSnapshots,
  transition,
  notification,
  deliver,
  readState,
  runMonitor,
} from '../../scripts/ubuntu/discord-monitor.js';

const hook =
  'https://discord.com/api/webhooks/123456789012345678/fictitious_token_for_local_tests_only';
const now = Date.parse('2026-10-24T12:00:00Z');
const active = {
  load: 'loaded',
  active: 'active',
  sub: 'running',
  result: 'success',
  restarts: 0,
  invocation: 'a'.repeat(32),
};
const stopped = { ...active, active: 'inactive', sub: 'dead' };
const snapshots = (api = active) =>
  Object.fromEntries(services.map((name, i) => [name, i ? { ...active } : { ...api }]));
const empty = () => ({ version: 1, snapshots: {}, pending: [], dropped: 0, nextAttemptAt: 0 });
const statePath = () => join(mkdtempSync(join(tmpdir(), 'credito-discord-test-')), 'state.json');
const accepted = async () =>
  new globalThis.Response(JSON.stringify({ id: '123456789012345679' }), { status: 200 });

describe('Discord process monitor', () => {
  it('accepts only official HTTPS webhook endpoints and requests explicit acknowledgement', () => {
    assert.equal(webhookUrl(hook).search, '?wait=true');
    for (const value of [
      'http://discord.com/api/webhooks/1/token',
      hook.replace('discord.com', 'discord.com.attacker.test'),
      hook + '?thread_id=1',
      'https://secret:password@discord.com/api/webhooks/123456789012345678/fictitious_token_for_local_tests_only',
    ]) {
      assert.throws(
        () => webhookUrl(value),
        (error) => !error.message.includes(value),
      );
    }
  });

  it('collects only fixed service names and selected properties without reading journals', () => {
    const calls = [];
    const result = collectSnapshots((command, args) => {
      calls.push([command, args]);
      return (
        'LoadState=loaded\nActiveState=active\nSubState=running\nResult=success\nNRestarts=2\nInvocationID=' +
        'b'.repeat(32) +
        '\n'
      );
    });
    assert.equal(calls.length, 3);
    assert.deepEqual(
      calls.map((call) => call[1][1]),
      services,
    );
    assert.equal(result[services[0]].restarts, 2);
    assert.ok(calls.every(([command]) => command === 'systemctl'));
  });

  it('alerts if a monitored unit disappears, but reports systemctl errors safely', () => {
    const missing = collectSnapshots(() => {
      const error = new Error('private stderr');
      error.stdout = 'LoadState=not-found\nActiveState=inactive\nSubState=dead';
      throw error;
    });
    assert.equal(transition(empty(), missing, now).pending.length, 3);
    assert.throws(
      () =>
        collectSnapshots(() => {
          throw new Error(hook);
        }),
      /No fue posible consultar systemd/,
    );
  });

  it('sanitizes unexpected property content rather than forwarding command output', () => {
    const result = parseSnapshot(
      'LoadState=loaded\nActiveState=' + hook + '\nResult=@everyone\nNRestarts=-1',
    );
    assert.equal(result.active, 'unknown');
    assert.equal(result.result, 'unknown');
    assert.equal(result.restarts, 0);
  });

  it('stays quiet on an initially healthy server and during unchanged polls', async () => {
    const file = statePath();
    let sends = 0;
    const opts = {
      statePath: file,
      url: webhookUrl(hook),
      snapshots: snapshots(),
      now,
      fetchFn: async () => {
        sends++;
        return accepted();
      },
    };
    await runMonitor(opts);
    await runMonitor({ ...opts, now: now + 30000 });
    assert.equal(sends, 0);
    assert.equal(readState(file).pending.length, 0);
  });

  it('records a stop once and records the subsequent recovery', () => {
    const baseline = transition(empty(), snapshots(), now);
    const down = transition(baseline, snapshots(stopped), now + 30000);
    assert.equal(down.pending[0].kind, 'down');
    assert.equal(transition(down, snapshots(stopped), now + 60000).pending.length, 1);
    const recovery = transition(down, snapshots(), now + 90000);
    assert.deepEqual(
      recovery.pending.map((e) => e.kind),
      ['down', 'recovered'],
    );
  });

  it('detects a crash that recovered between polls and a manual process restart', () => {
    const baseline = transition(empty(), snapshots(), now);
    assert.equal(
      transition(baseline, snapshots({ ...active, restarts: 1 }), now + 30000).pending[0].kind,
      'restarted',
    );
    assert.equal(
      transition(baseline, snapshots({ ...active, invocation: 'b'.repeat(32) }), now + 30000)
        .pending[0].kind,
      'restarted',
    );
  });

  it('persists before POST, keeps events on a timeout and reuses the event ID on retry', async () => {
    const file = statePath();
    const logs = [];
    let originalId;
    const first = await runMonitor({
      statePath: file,
      url: webhookUrl(hook),
      snapshots: snapshots(stopped),
      now,
      log: (s) => logs.push(s),
      retryClock: () => now,
      fetchFn: async () => {
        originalId = JSON.parse(readFileSync(file, 'utf8')).pending[0].id;
        throw new Error('Network error containing ' + hook);
      },
    });
    assert.equal(first.pending.length, 1);
    assert.ok(!logs.join('').includes(hook));
    let sends = 0;
    await runMonitor({
      statePath: file,
      url: webhookUrl(hook),
      snapshots: snapshots(stopped),
      now: now + 1000,
      fetchFn: async () => {
        throw Error('Should not send');
      },
    });
    const last = await runMonitor({
      statePath: file,
      url: webhookUrl(hook),
      snapshots: snapshots(stopped),
      now: now + 31000,
      fetchFn: async (_url, init) => {
        sends++;
        assert.ok(JSON.parse(init.body).content.includes(originalId));
        return accepted();
      },
    });
    assert.equal(sends, 1);
    assert.equal(last.pending.length, 0);
  });

  it('honors Discord rate limiting across separate timer executions', async () => {
    const file = statePath();
    const first = await runMonitor({
      statePath: file,
      url: webhookUrl(hook),
      snapshots: snapshots(stopped),
      now,
      log: () => {},
      retryClock: () => now,
      fetchFn: async () =>
        new globalThis.Response(JSON.stringify({ retry_after: 120 }), { status: 429 }),
    });
    assert.equal(first.nextAttemptAt, now + 120000);
    const result = await runMonitor({
      statePath: file,
      url: webhookUrl(hook),
      snapshots: snapshots(stopped),
      now: now + 60000,
      fetchFn: async () => {
        throw Error('Should not send');
      },
    });
    assert.equal(result.pending.length, 1);
    assert.equal(result.nextAttemptAt, now + 120000);
  });

  it('counts Retry-After from the response, including the time spent waiting for Discord', async () => {
    const file = statePath();
    const result = await runMonitor({
      statePath: file,
      url: webhookUrl(hook),
      snapshots: snapshots(stopped),
      now,
      retryClock: () => now + 8000,
      log: () => {},
      fetchFn: async () =>
        new globalThis.Response(JSON.stringify({ retry_after: 120 }), { status: 429 }),
    });
    assert.equal(result.nextAttemptAt, now + 128000);
  });

  it('requires a confirmed message ID, disables redirects and never forwards response content', async () => {
    const failed = await deliver(webhookUrl(hook), { content: 'test' }, async (_url, init) => {
      assert.equal(init.redirect, 'error');
      return new globalThis.Response(null, { status: 204 });
    });
    assert.equal(failed.delivered, false);
    const denied = await deliver(
      webhookUrl(hook),
      {},
      async () => new globalThis.Response(hook, { status: 401 }),
    );
    assert.equal(denied.retryMs, 900000);
    assert.ok(!denied.reason.includes(hook));
  });

  it('uses a bounded persistent queue and reports overflow instead of hiding it', () => {
    let state = transition(empty(), snapshots(), now);
    for (let i = 0; i < 110; i++)
      state = transition(state, snapshots(i % 2 ? active : stopped), now + i * 30000);
    assert.equal(state.pending.length, 100);
    assert.equal(state.dropped, 10);
    const payload = notification(state.pending.slice(0, 5), state.dropped);
    assert.ok(payload.content.includes('10 eventos'));
    assert.ok(payload.content.length <= 2000);
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
  });

  it('does not silently replace corrupted monitoring state', () => {
    const file = statePath();
    writeFileSync(file, 'not JSON');
    assert.throws(() => readState(file), /no se descarta automáticamente/);
    assert.equal(readFileSync(file, 'utf8'), 'not JSON');
  });
});
