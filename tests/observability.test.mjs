import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const {
  BACKEND_OBSERVABILITY_MARKER_TOPIC,
  BACKEND_MARKERS,
  FRONTEND_OBSERVABILITY_TOPIC,
  FRONTEND_EVENTS,
  OBSERVABILITY_ATTRS,
  OBSERVABILITY_EVENT_TYPES,
  outputSegmentAttributesFromMarker,
  parseBackendObservabilityMarkerPayload,
  publishFrontendObservabilityEvent,
} = await import('../lib/observability.ts');

test('frontend observability does not publish when disabled', async () => {
  const calls = [];
  const room = {
    name: 'voice_assistant_room_a',
    localParticipant: {
      identity: 'voice_assistant_user_a',
      publishData: async (...args) => {
        calls.push(args);
      },
    },
  };

  const published = await publishFrontendObservabilityEvent({
    enabled: false,
    room,
    name: 'frontend.room.connected',
  });

  assert.equal(published, false);
  assert.equal(calls.length, 0);
});

test('frontend observability exports shared event protocol constants', () => {
  assert.equal(OBSERVABILITY_EVENT_TYPES.FRONTEND_EVENT, 'observability.frontend_event');
  assert.equal(OBSERVABILITY_EVENT_TYPES.BACKEND_MARKER, 'observability.backend_marker');
  assert.equal(
    FRONTEND_EVENTS.REPLY_AUDIO_PLAYBACK_STARTED,
    'frontend.reply_audio.playback_started'
  );
  assert.equal(
    BACKEND_MARKERS.OUTPUT_AUDIO_SEGMENT_STARTED,
    'backend.output_audio.segment_started'
  );
  assert.equal(OBSERVABILITY_ATTRS.PARTICIPANT_IDENTITY, 'livekit.participant_identity');
  assert.equal(OBSERVABILITY_ATTRS.OUTPUT_SEGMENT_ID, 'observability.output_segment_id');
});

test('frontend observability publishes livekit data packet payload', async () => {
  const calls = [];
  const room = {
    name: 'voice_assistant_room_a',
    localParticipant: {
      identity: 'voice_assistant_user_a',
      publishData: async (...args) => {
        calls.push(args);
      },
    },
  };

  const published = await publishFrontendObservabilityEvent({
    enabled: true,
    room,
    name: 'frontend.browser_audio.track_published',
    attributes: {
      'livekit.track_name': 'browser_audio_track',
      'livekit.track_sid': 'TR_A',
    },
    now: () => 1_779_773_931_123,
    performanceNow: () => 123.45,
  });

  assert.equal(published, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], {
    reliable: true,
    topic: FRONTEND_OBSERVABILITY_TOPIC,
  });

  const payload = JSON.parse(new TextDecoder().decode(calls[0][0]));
  assert.deepEqual(payload, {
    schema_version: 1,
    type: 'observability.frontend_event',
    name: 'frontend.browser_audio.track_published',
    wall_time_unix_ms: 1_779_773_931_123,
    performance_now_ms: 123.45,
    room_name: 'voice_assistant_room_a',
    participant_identity: 'voice_assistant_user_a',
    attributes: {
      'livekit.track_name': 'browser_audio_track',
      'livekit.track_sid': 'TR_A',
    },
  });
});

test('frontend observability can publish an explicit event wall time', async () => {
  const calls = [];
  const room = {
    localParticipant: {
      publishData: async (...args) => {
        calls.push(args);
      },
    },
  };

  await publishFrontendObservabilityEvent({
    enabled: true,
    room,
    name: 'frontend.browser_audio.last_active_frame_sent',
    wallTimeUnixMs: 1_779_773_930_777,
    now: () => 1_779_773_931_123,
    performanceNow: () => 456.78,
  });

  const payload = JSON.parse(new TextDecoder().decode(calls[0][0]));
  assert.equal(payload.wall_time_unix_ms, 1_779_773_930_777);
  assert.equal(payload.performance_now_ms, 456.78);
});

test('frontend observability parses backend output segment markers', () => {
  const payload = {
    schema_version: 1,
    type: 'observability.backend_marker',
    name: 'backend.output_audio.segment_started',
    attributes: {
      'observability.turn_id': 'turn-000001',
      'observability.output_segment_id': 'turn-000001-output-002',
      'observability.output_segment_index': 2,
      'observability.output_segment_kind': 'final',
      'livekit.participant_identity': 'agent',
      'livekit.track_name': 'assistant_audio',
    },
  };

  const marker = parseBackendObservabilityMarkerPayload(
    new TextEncoder().encode(JSON.stringify(payload)),
    BACKEND_OBSERVABILITY_MARKER_TOPIC
  );

  assert.equal(marker?.name, 'backend.output_audio.segment_started');
  assert.deepEqual(outputSegmentAttributesFromMarker(marker), {
    'observability.turn_id': 'turn-000001',
    'observability.output_segment_id': 'turn-000001-output-002',
    'observability.output_segment_index': 2,
    'observability.output_segment_kind': 'final',
  });
});

test('frontend observability rejects backend markers on the wrong topic', () => {
  const marker = parseBackendObservabilityMarkerPayload(
    JSON.stringify({
      schema_version: 1,
      type: 'observability.backend_marker',
      name: 'backend.output_audio.segment_started',
      attributes: {},
    }),
    FRONTEND_OBSERVABILITY_TOPIC
  );

  assert.equal(marker, null);
});

test('app mounts remote audio playback observability when enabled', async () => {
  const source = await readFile('components/app/app.tsx', 'utf8');

  assert.match(source, /RemoteAudioPlaybackObserver/);
  assert.match(source, /observabilityEnabled=\{appConfig\.observabilityEnabled\}/);
});

test('track exclusion helpers ignore empty exclude names', async () => {
  const sources = await Promise.all(
    [
      'components/livekit/remote-audio-playback-observer.tsx',
      'components/livekit/filtered-audio-renderer.tsx',
      'hooks/useAudioTrackFilter.ts',
      'hooks/useExcludedVideoTracks.ts',
    ].map(async (path) => [path, await readFile(path, 'utf8')])
  );

  for (const [path, source] of sources) {
    assert.match(source, /if \(!excludeName\) \{\s*return false;\s*\}/, path);
    assert.doesNotMatch(source, /trackName === excludeName/, path);
  }
});

test('remote audio observer uses protocol identity field with documented fallback', async () => {
  const source = await readFile('components/livekit/remote-audio-playback-observer.tsx', 'utf8');

  assert.match(source, /OBSERVABILITY_ATTRS\.PARTICIPANT_IDENTITY/);
  assert.match(source, /legacy field/);
});

test('browser source client publishes frontend audio observability events', async () => {
  const source = await readFile('hooks/useBrowserSourceClient.ts', 'utf8');

  assert.match(source, /startMediaTrackTailObserver/);
  assert.match(source, /FRONTEND_EVENTS\.BROWSER_AUDIO_TRACK_PUBLISHED/);
  assert.match(source, /FRONTEND_EVENTS\.BROWSER_AUDIO_TRACK_UNPUBLISHED/);
  assert.match(source, /FRONTEND_EVENTS\.BROWSER_AUDIO_LAST_ACTIVE_FRAME_SENT/);
  assert.match(source, /stop:\s*\(\) => Promise<void>/);
});

test('room hook publishes room connected frontend observability event', async () => {
  const source = await readFile('hooks/useRoom.ts', 'utf8');

  assert.match(source, /FRONTEND_EVENTS\.ROOM_CONNECTED/);
  assert.match(source, /publishFrontendObservabilityEvent/);
});
