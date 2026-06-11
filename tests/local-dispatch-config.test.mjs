import assert from 'node:assert/strict';
import { test } from 'node:test';

async function loadAppConfigModule() {
  return import('../app-config.ts');
}

test('frontend derives dispatch agent name from INPUT_SOURCE when AGENT_NAME is unset', async () => {
  const { resolveAgentNameForInputSource } = await loadAppConfigModule();

  assert.equal(resolveAgentNameForInputSource('xunfei'), 'frontdesk-xunfei-agent');
  assert.equal(resolveAgentNameForInputSource('generic'), 'frontdesk-generic-agent');
  assert.equal(resolveAgentNameForInputSource('browser'), 'frontdesk-browser-agent');
  assert.equal(resolveAgentNameForInputSource('primebot'), 'frontdesk-agent');
  assert.equal(resolveAgentNameForInputSource('mixed'), 'frontdesk-mixed-agent');
  assert.equal(resolveAgentNameForInputSource('robot'), 'frontdesk-robot-agent');
});

test('frontend keeps explicit AGENT_NAME as an override', async () => {
  const { resolveAgentNameForInputSource } = await loadAppConfigModule();

  assert.equal(resolveAgentNameForInputSource('generic', 'custom-agent'), 'custom-agent');
});
