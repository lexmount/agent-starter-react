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

test('frontend resolves mixed browser audio with xunfei vision role devices', async () => {
  const { resolveInputDeviceConfig } = await loadAppConfigModule();

  const config = resolveInputDeviceConfig({
    inputSource: 'mixed',
    audioInputDevice: 'browser',
    visionInputDevice: 'xunfei',
  });

  assert.equal(config.inputSource, 'mixed');
  assert.equal(config.audioInputDevice, 'browser');
  assert.equal(config.visionInputDevice, 'xunfei');
  assert.equal(config.usesBrowserRawAudioInput, true);
  assert.equal(config.usesBrowserRawVideoInput, false);
  assert.equal(config.usesBrowserRawMediaInput, true);
  assert.equal(config.usesServerRoomInput, true);
  assert.equal(config.supportsScreenShare, true);
  assert.equal(config.showDefaultCameraPreview, true);
});

test('frontend resolves mixed xunfei audio with browser vision role devices', async () => {
  const { resolveInputDeviceConfig } = await loadAppConfigModule();

  const config = resolveInputDeviceConfig({
    inputSource: 'mixed',
    audioInputDevice: 'xunfei',
    visionInputDevice: 'browser',
  });

  assert.equal(config.usesBrowserRawAudioInput, false);
  assert.equal(config.usesBrowserRawVideoInput, true);
  assert.equal(config.usesBrowserRawMediaInput, true);
  assert.equal(config.usesServerRoomInput, true);
  assert.equal(config.supportsScreenShare, false);
  assert.equal(config.showDefaultCameraPreview, false);
});

test('frontend ignores role devices unless INPUT_SOURCE is mixed', async () => {
  const { resolveInputDeviceConfig } = await loadAppConfigModule();

  const config = resolveInputDeviceConfig({
    inputSource: 'browser',
    audioInputDevice: 'xunfei',
    visionInputDevice: 'generic',
    outputDevice: 'primebot_output',
  });

  assert.equal(config.inputSource, 'browser');
  assert.equal(config.audioInputDevice, 'browser');
  assert.equal(config.visionInputDevice, 'browser');
  assert.equal(config.outputDevice, 'browser');
  assert.equal(config.usesBrowserRawAudioInput, true);
  assert.equal(config.usesBrowserRawVideoInput, true);
});
