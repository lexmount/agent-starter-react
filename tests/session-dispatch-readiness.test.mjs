import assert from 'node:assert/strict';
import { test } from 'node:test';

const { ParticipantInfo_Kind, ParticipantInfo_State, TrackType } = await import(
  '@livekit/protocol'
);
const { AGENT_SESSION_READY_ATTRIBUTE, findReusableAgentParticipant } = await import(
  '../lib/session-dispatch-readiness.ts'
);
const { waitForExistingRoomSessionReadiness } = await import(
  '../app/api/session/session-dispatch-service.ts'
);

function participant({
  identity,
  kind = ParticipantInfo_Kind.STANDARD,
  state = ParticipantInfo_State.ACTIVE,
  attributes = {},
  tracks = [],
}) {
  return {
    identity,
    kind,
    state,
    attributes,
    tracks,
  };
}

test('dispatch reuses an active agent by default without room video input readiness', () => {
  const agent = participant({
    identity: 'agent-AJ_running',
    kind: ParticipantInfo_Kind.AGENT,
    attributes: { 'lk.agent.name': 'frontdesk-browser-agent' },
  });
  const participants = [
    agent,
    participant({
      identity: 'voice_assistant_user_session',
      tracks: [{ name: 'browser_video_track', type: TrackType.VIDEO, muted: false }],
    }),
  ];

  assert.equal(findReusableAgentParticipant(participants, 'frontdesk-browser-agent'), agent);
});

test('dispatch can require room video input readiness before reusing an agent', () => {
  const participants = [
    participant({
      identity: 'agent-AJ_stale',
      kind: ParticipantInfo_Kind.AGENT,
      attributes: { 'lk.agent.name': 'frontdesk-browser-agent' },
    }),
    participant({
      identity: 'voice_assistant_user_session',
      tracks: [{ name: 'browser_video_track', type: TrackType.VIDEO, muted: false }],
    }),
  ];

  assert.equal(
    findReusableAgentParticipant(participants, 'frontdesk-browser-agent', {
      requireRoomVideoInputReady: true,
    }),
    null
  );
});

test('dispatch can reuse an active agent once room video input is publishing', () => {
  const agent = participant({
    identity: 'agent-AJ_running',
    kind: ParticipantInfo_Kind.AGENT,
    attributes: { 'lk.agent.name': 'frontdesk-browser-agent' },
  });
  const participants = [
    agent,
    participant({
      identity: 'room_video_input',
      kind: ParticipantInfo_Kind.AGENT,
      tracks: [{ name: 'room_video', type: TrackType.VIDEO, muted: false }],
    }),
  ];

  assert.equal(
    findReusableAgentParticipant(participants, 'frontdesk-browser-agent', {
      requireRoomVideoInputReady: true,
    }),
    agent
  );
});

test('room input readiness requires the exact active unmuted audio, raw-video, and processed-video tracks', () => {
  const agent = participant({
    identity: 'agent-AJ_running',
    kind: ParticipantInfo_Kind.AGENT,
    attributes: { 'lk.agent.name': 'frontdesk-browser-agent' },
  });
  const participants = [
    agent,
    participant({
      identity: 'room_audio_input',
      tracks: [
        { name: 'room_audio', type: TrackType.AUDIO, muted: false },
        { name: 'room_video_raw', type: TrackType.VIDEO, muted: false },
      ],
    }),
    participant({
      identity: 'room_video_input',
      tracks: [{ name: 'room_video', type: TrackType.VIDEO, muted: false }],
    }),
  ];

  assert.equal(
    findReusableAgentParticipant(participants, 'frontdesk-browser-agent', {
      requireExactRoomInputTracksReady: true,
    }),
    agent
  );
});

test('exact Generic readiness keeps room_video fixed despite legacy track configuration', () => {
  const previous = process.env.NEXT_PUBLIC_ROOM_VISION_TRACK_NAME;
  process.env.NEXT_PUBLIC_ROOM_VISION_TRACK_NAME = 'configured_other_video';
  const agent = participant({
    identity: 'agent-AJ_running',
    kind: ParticipantInfo_Kind.AGENT,
    attributes: { 'lk.agent.name': 'frontdesk-browser-agent' },
  });
  const participants = [
    agent,
    participant({
      identity: 'room_audio_input',
      tracks: [
        { name: 'room_audio', type: TrackType.AUDIO, muted: false },
        { name: 'room_video_raw', type: TrackType.VIDEO, muted: false },
      ],
    }),
    participant({
      identity: 'room_video_input',
      tracks: [{ name: 'room_video', type: TrackType.VIDEO, muted: false }],
    }),
  ];

  try {
    assert.equal(
      findReusableAgentParticipant(participants, 'frontdesk-browser-agent', {
        requireExactRoomInputTracksReady: true,
      }),
      agent
    );
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_ROOM_VISION_TRACK_NAME;
    else process.env.NEXT_PUBLIC_ROOM_VISION_TRACK_NAME = previous;
  }
});

test('room input readiness rejects active participants with missing, muted, or misnamed tracks', () => {
  const agent = participant({
    identity: 'agent-AJ_running',
    kind: ParticipantInfo_Kind.AGENT,
    attributes: { 'lk.agent.name': 'frontdesk-browser-agent' },
  });
  for (const roomInputs of [
    [participant({ identity: 'room_audio_input' }), participant({ identity: 'room_video_input' })],
    [
      participant({
        identity: 'room_audio_input',
        tracks: [
          { name: 'room_audio', type: TrackType.AUDIO, muted: true },
          { name: 'room_video_raw', type: TrackType.VIDEO, muted: false },
        ],
      }),
      participant({
        identity: 'room_video_input',
        tracks: [{ name: 'room_video', type: TrackType.VIDEO, muted: false }],
      }),
    ],
    [
      participant({
        identity: 'room_audio_input',
        tracks: [
          { name: 'room_audio', type: TrackType.AUDIO, muted: false },
          { name: 'wrong_raw_video', type: TrackType.VIDEO, muted: false },
        ],
      }),
      participant({
        identity: 'room_video_input',
        tracks: [{ name: 'room_video', type: TrackType.VIDEO, muted: false }],
      }),
    ],
  ]) {
    assert.equal(
      findReusableAgentParticipant([agent, ...roomInputs], 'frontdesk-browser-agent', {
        requireExactRoomInputTracksReady: true,
      }),
      null
    );
  }
});

test('prewarm can require the full agent session ready marker', () => {
  const agent = participant({
    identity: 'agent-AJ_running',
    kind: ParticipantInfo_Kind.AGENT,
    attributes: { 'lk.agent.name': 'frontdesk-browser-agent' },
  });
  const participants = [
    agent,
    participant({ identity: 'room_audio_input' }),
    participant({ identity: 'room_video_input' }),
  ];
  const options = {
    requireAgentSessionReady: true,
    requireRoomInputParticipantsReady: true,
  };

  assert.equal(
    findReusableAgentParticipant(participants, 'frontdesk-browser-agent', options),
    null
  );

  agent.attributes[AGENT_SESSION_READY_ATTRIBUTE] = 'true';
  assert.equal(
    findReusableAgentParticipant(participants, 'frontdesk-browser-agent', options),
    agent
  );
});

test('prewarm readiness rejects a room missing either input participant', () => {
  const participants = [
    participant({
      identity: 'agent-AJ_running',
      kind: ParticipantInfo_Kind.AGENT,
      attributes: { 'lk.agent.name': 'frontdesk-browser-agent' },
    }),
    participant({ identity: 'room_video_input' }),
  ];

  assert.equal(
    findReusableAgentParticipant(participants, 'frontdesk-browser-agent', {
      requireRoomInputParticipantsReady: true,
    }),
    null
  );
});

test('dispatch does not reuse disconnected agents', () => {
  const participants = [
    participant({
      identity: 'agent-AJ_disconnected',
      kind: ParticipantInfo_Kind.AGENT,
      state: ParticipantInfo_State.DISCONNECTED,
      attributes: { 'lk.agent.name': 'frontdesk-browser-agent' },
    }),
    participant({
      identity: 'room_video_input',
      kind: ParticipantInfo_Kind.AGENT,
      tracks: [{ name: 'room_video', type: TrackType.VIDEO, muted: false }],
    }),
  ];

  assert.equal(findReusableAgentParticipant(participants, 'frontdesk-browser-agent'), null);
});

test('post-Edge readiness polls exact tracks without creating another Agent dispatch', async () => {
  const agent = participant({
    identity: 'agent-AJ_running',
    kind: ParticipantInfo_Kind.AGENT,
    attributes: { 'lk.agent.name': 'lexvoice-generic-agent' },
  });
  const ready = [
    agent,
    participant({
      identity: 'room_audio_input',
      tracks: [
        { name: 'room_audio', type: TrackType.AUDIO, muted: false },
        { name: 'room_video_raw', type: TrackType.VIDEO, muted: false },
      ],
    }),
    participant({
      identity: 'room_video_input',
      tracks: [{ name: 'room_video', type: TrackType.VIDEO, muted: false }],
    }),
  ];
  const participantSnapshots = [[agent], ready];
  let sleeps = 0;

  const result = await waitForExistingRoomSessionReadiness(
    {
      roomName: 'room-1',
      agentName: 'lexvoice-generic-agent',
    },
    {
      roomClient: {
        listParticipants: async () => participantSnapshots.shift(),
      },
      timeoutMs: 1_000,
      pollMs: 1,
      sleep: async () => {
        sleeps += 1;
      },
    }
  );

  assert.deepEqual(result, { identity: 'agent-AJ_running' });
  assert.equal(sleeps, 1);
});

test('post-Edge readiness observes cancellation while polling', async () => {
  let cancelled = false;
  await assert.rejects(
    waitForExistingRoomSessionReadiness(
      { roomName: 'room-1', agentName: 'lexvoice-generic-agent' },
      {
        roomClient: { listParticipants: async () => [] },
        timeoutMs: 1_000,
        pollMs: 1,
        sleep: async () => {
          cancelled = true;
        },
        isCancelled: () => cancelled,
      }
    ),
    /cancelled/
  );
});
