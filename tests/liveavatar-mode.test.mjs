import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveLiveAvatarMode } from '../scripts/liveavatar-mode.mjs';

test('liveavatar mode defaults to the direct app', () => {
  assert.equal(resolveLiveAvatarMode({}), 'app');
});

test('LIVEAVATAR_USE_SANDBOX enables the sandbox gateway', () => {
  assert.equal(resolveLiveAvatarMode({ LIVEAVATAR_USE_SANDBOX: '1' }), 'sandbox-gateway');
  assert.equal(resolveLiveAvatarMode({ LIVEAVATAR_USE_SANDBOX: 'true' }), 'sandbox-gateway');
});

test('LIVEAVATAR_USE_SANDBOX=0 disables the sandbox gateway', () => {
  assert.equal(resolveLiveAvatarMode({ LIVEAVATAR_USE_SANDBOX: '0' }), 'app');
  assert.equal(resolveLiveAvatarMode({ LIVEAVATAR_USE_SANDBOX: 'false' }), 'app');
});
