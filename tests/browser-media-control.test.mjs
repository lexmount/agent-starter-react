import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserMediaControlTracker,
  parseBrowserMediaControl,
} from '../lib/browser-media-control.ts';

function packet(overrides = {}) {
  return new TextEncoder().encode(JSON.stringify({
    schema_version: 1,
    type: 'lk.media.control',
    command_id: 'command-1',
    policy_epoch: 'epoch-1',
    sequence: 1,
    target_identity: 'browser-user',
    desired_listening: 'open',
    issued_at_unix_ms: 1_000,
    expires_at_unix_ms: 2_000,
    ...overrides,
  }));
}

test('accepts a fresh command for the exact browser identity', () => {
  const command = parseBrowserMediaControl(packet(), 'browser-user', 1_500);
  assert.equal(command?.desired_listening, 'open');
});

test('fails closed for expired, malformed, or wrong-target commands', () => {
  assert.equal(parseBrowserMediaControl(packet(), 'other', 1_500), null);
  assert.equal(parseBrowserMediaControl(packet(), 'browser-user', 2_000), null);
  assert.equal(parseBrowserMediaControl(new TextEncoder().encode('{'), 'browser-user'), null);
});

test('rejects replayed sequences and retired policy epochs', () => {
  const tracker = new BrowserMediaControlTracker();
  const first = parseBrowserMediaControl(packet(), 'browser-user', 1_500);
  const stale = parseBrowserMediaControl(packet({ command_id: 'stale' }), 'browser-user', 1_500);
  const nextEpoch = parseBrowserMediaControl(packet({
    command_id: 'next', policy_epoch: 'epoch-2', expires_at_unix_ms: 2_500,
  }), 'browser-user', 1_500);
  const replay = parseBrowserMediaControl(packet({
    command_id: 'replay', sequence: 2, expires_at_unix_ms: 2_500,
  }), 'browser-user', 1_500);
  assert.ok(first && stale && nextEpoch && replay);
  assert.equal(tracker.accept(first), true);
  assert.equal(tracker.accept(stale), false);
  assert.equal(tracker.accept(nextEpoch), true);
  assert.equal(tracker.accept(replay), false);
});
