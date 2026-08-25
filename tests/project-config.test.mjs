import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getClientConfigFromEnv } from '../lib/utils.ts';

test('shadcn config points at the imported Tailwind CSS file', async () => {
  const config = JSON.parse(await readFile('components.json', 'utf8'));
  const layout = await readFile('app/layout.tsx', 'utf8');

  assert.equal(config.tailwind.css, 'styles/globals.css');
  assert.match(layout, /import '@\/styles\/globals\.css'/);
});

test('README matches the documented LexVoice environment source', async () => {
  const readme = await readFile('README.md', 'utf8');
  const envExample = await readFile('.env.example', 'utf8');

  assert.match(envExample, /documentation-only/);
  assert.match(readme, /LexVoice repository `\.env`/);
  assert.doesNotMatch(readme, /\blex-voice\b/);
  assert.doesNotMatch(envExample, /\blex-voice\b/);
  assert.match(readme, /single Next\.js instance or sticky routing/);
  assert.match(readme, /custom connection details endpoint/);
  assert.match(readme, /sessionId/);
  assert.doesNotMatch(readme, /INPUT_SOURCE=browser/);
  assert.doesNotMatch(readme, /copy `\.env\.example`/i);
});

test('integrated Generic configuration is delegated to LexVoice', async () => {
  const readme = await readFile('README.md', 'utf8');
  const envExample = await readFile('.env.example', 'utf8');

  for (const name of [
    'INPUT_SOURCE',
    'AGENT_NAME',
    'LIVEKIT_URL',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'VIDEO_PROCESSOR_URL',
    'ENDPOINT_CONNECTIVITY_TOKEN',
    'EDGE_MEDIA_CONTROL_TOKEN',
    'GENERIC_EDGE_MEDIA_DEVICE_ID',
    'GENERIC_EDGE_MEDIA_ALLOWED_CIDRS',
    'GENERIC_ENDPOINT_REGISTRY_DIR',
  ]) {
    assert.doesNotMatch(envExample, new RegExp(`^${name}=`, 'm'));
  }

  assert.match(readme, /Generic configuration.*LexVoice unified Mac startup/i);
  assert.match(readme, /do not add.*\.env\.example.*\.env\.local/i);
  assert.doesNotMatch(readme, /For Generic endpoint discovery, configure the server-only/);
  assert.match(readme, /Agent joins first/);
  assert.match(readme, /room_audio_input.*room_audio/);
  assert.match(readme, /room_audio_input.*room_video_raw/);
  assert.match(readme, /room_video_input.*room_video/);
});

test('avatar filtering excludes the current room video input identity', async () => {
  const source = await readFile('hooks/useSmartVoiceAssistant.ts', 'utf8');

  assert.match(source, /room_video_input/);
});

test('client config reads frontend observability from OBSERVABILITY_ENABLED only', () => {
  const previousObservability = process.env.OBSERVABILITY_ENABLED;
  const previousNextPublicObservability = process.env.NEXT_PUBLIC_OBSERVABILITY_ENABLED;
  try {
    delete process.env.OBSERVABILITY_ENABLED;
    process.env.NEXT_PUBLIC_OBSERVABILITY_ENABLED = '1';
    assert.equal(getClientConfigFromEnv().observabilityEnabled, false);

    process.env.OBSERVABILITY_ENABLED = '1';
    assert.equal(getClientConfigFromEnv().observabilityEnabled, true);
  } finally {
    if (previousObservability === undefined) {
      delete process.env.OBSERVABILITY_ENABLED;
    } else {
      process.env.OBSERVABILITY_ENABLED = previousObservability;
    }
    if (previousNextPublicObservability === undefined) {
      delete process.env.NEXT_PUBLIC_OBSERVABILITY_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_OBSERVABILITY_ENABLED = previousNextPublicObservability;
    }
  }
});
