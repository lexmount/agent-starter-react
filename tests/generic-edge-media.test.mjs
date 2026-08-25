import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  coordinateGenericRoomSession,
  createGenericRoomInputToken,
  pairGenericEdgeMedia,
  requestGenericEdgeControl,
  resolveGenericEdgeTargetSnapshot,
  stopGenericEdgeMedia,
} from '../app/api/session/generic-edge-media-pairing.ts';

test('Generic pairing reclaims stale state, starts exactly once, then waits for exact media', async () => {
  const events = [];
  const config = {
    startUrl: 'http://10.2.2.199:8013/start',
    stopUrl: 'http://10.2.2.199:8013/stop',
    controlToken: 'control-secret',
    deviceId: 'generic-orin',
    address: '10.2.2.199',
  };
  const result = await pairGenericEdgeMedia(
    {
      roomUrl: 'ws://10.2.77.108:7818',
      roomName: 'voice_assistant_room_session-1',
      sessionId: 'session-1',
      controlSenderIdentity: 'agent-joined',
    },
    {
      config,
      createRoomToken: async () => 'short-lived-room-token',
      requestControl: async (action, payload, resolvedConfig) => {
        events.push({ action, payload, resolvedConfig });
      },
      waitForReadiness: async () => {
        events.push({ action: 'wait' });
      },
    }
  );

  assert.deepEqual(
    events.map((event) => event.action),
    ['stop', 'start', 'wait']
  );
  const start = events[1];
  assert.equal(start.resolvedConfig.controlToken, 'control-secret');
  assert.deepEqual(start.payload, {
    room_url: 'ws://10.2.77.108:7818',
    room_token: 'short-lived-room-token',
    room_name: 'voice_assistant_room_session-1',
    session_id: 'session-1',
    service_instance_id: 'generic-orin',
    source_type: 'generic',
    control_sender_identity: 'agent-joined',
    participant_identity: 'room_audio_input',
    track_names: { audio: 'room_audio', video: 'room_video_raw' },
  });
  assert.deepEqual(result, { deviceId: 'generic-orin', address: '10.2.2.199' });
});

test('Generic pairing rolls endpoint state back when readiness fails', async () => {
  const actions = [];
  await assert.rejects(
    pairGenericEdgeMedia(
      {
        roomUrl: 'ws://livekit.test',
        roomName: 'room-1',
        sessionId: 'session-1',
        controlSenderIdentity: 'agent-joined',
      },
      {
        config: {
          startUrl: 'http://10.2.2.199:8013/start',
          stopUrl: 'http://10.2.2.199:8013/stop',
          controlToken: 'secret',
          deviceId: 'generic-orin',
          address: '10.2.2.199',
        },
        createRoomToken: async () => 'token',
        requestControl: async (action) => {
          actions.push(action);
        },
        waitForReadiness: async () => {
          throw new Error('media readiness timeout');
        },
      }
    ),
    /media readiness timeout/
  );
  assert.deepEqual(actions, ['stop', 'start', 'stop']);
});

test('Generic pairing performs no start when stale reclaim fails', async () => {
  const actions = [];
  await assert.rejects(
    pairGenericEdgeMedia(
      {
        roomUrl: 'ws://livekit.test',
        roomName: 'room-1',
        sessionId: 'session-1',
        controlSenderIdentity: 'agent-joined',
      },
      {
        config: {
          startUrl: 'http://10.2.2.199:8013/start',
          stopUrl: 'http://10.2.2.199:8013/stop',
          controlToken: 'secret',
          deviceId: 'generic-orin',
          address: '10.2.2.199',
        },
        createRoomToken: async () => assert.fail('token must not be created'),
        requestControl: async (action) => {
          actions.push(action);
          throw new Error('stale reclaim failed');
        },
        waitForReadiness: async () => assert.fail('readiness must not run'),
      }
    ),
    /stale reclaim failed/
  );
  assert.deepEqual(actions, ['stop']);
});

test('Generic pairing attempts rollback when start outcome is uncertain', async () => {
  const actions = [];
  await assert.rejects(
    pairGenericEdgeMedia(
      {
        roomUrl: 'ws://livekit.test',
        roomName: 'room-1',
        sessionId: 'session-1',
        controlSenderIdentity: 'agent-joined',
      },
      {
        config: {
          startUrl: 'http://10.2.2.199:8013/start',
          stopUrl: 'http://10.2.2.199:8013/stop',
          controlToken: 'secret',
          deviceId: 'generic-orin',
          address: '10.2.2.199',
        },
        createRoomToken: async () => 'token',
        requestControl: async (action) => {
          actions.push(action);
          if (action === 'start') throw new Error('start response lost');
        },
        waitForReadiness: async () => assert.fail('readiness must not run'),
      }
    ),
    /start response lost/
  );
  assert.deepEqual(actions, ['stop', 'start', 'stop']);
});

test('Generic pairing cancellation is material and rolls back the immutable target', async () => {
  const actions = [];
  let cancelled = false;
  await assert.rejects(
    pairGenericEdgeMedia(
      {
        roomUrl: 'ws://livekit.test',
        roomName: 'room-1',
        sessionId: 'session-1',
        controlSenderIdentity: 'agent-joined',
      },
      {
        config: Object.freeze({
          startUrl: 'http://10.2.2.199:8013/start',
          stopUrl: 'http://10.2.2.199:8013/stop',
          controlToken: 'secret',
          deviceId: 'generic-orin',
          address: '10.2.2.199',
        }),
        createRoomToken: async () => 'token',
        requestControl: async (action, _payload, config) => {
          actions.push(`${action}:${config.address}`);
        },
        waitForReadiness: async () => {
          cancelled = true;
        },
        isCancelled: () => cancelled,
      }
    ),
    /cancelled/
  );
  assert.deepEqual(actions, ['stop:10.2.2.199', 'start:10.2.2.199', 'stop:10.2.2.199']);
});

test('Generic pairing reports an unconfirmed immutable-target rollback as material', async () => {
  let stopAttempts = 0;
  await assert.rejects(
    pairGenericEdgeMedia(
      {
        roomUrl: 'ws://livekit.test',
        roomName: 'room-1',
        sessionId: 'session-1',
        controlSenderIdentity: 'agent-joined',
      },
      {
        config: {
          startUrl: 'http://10.2.2.199:8013/start',
          stopUrl: 'http://10.2.2.199:8013/stop',
          controlToken: 'control-secret',
          deviceId: 'generic-orin',
          address: '10.2.2.199',
        },
        createRoomToken: async () => 'room-token',
        requestControl: async (action) => {
          if (action === 'stop' && ++stopAttempts === 2) {
            throw new Error('control-secret rollback body');
          }
        },
        waitForReadiness: async () => {
          throw new Error('media readiness timeout');
        },
      }
    ),
    (error) => {
      assert.match(error.message, /rollback could not be confirmed/);
      assert.doesNotMatch(error.message, /control-secret|room-token|rollback body/);
      return true;
    }
  );
});

test('production target resolution uses one active lease and never reads a static URL', async () => {
  const events = [];
  const leaseConfig = { deviceId: 'generic-orin', registryDir: '/safe/registry' };
  const target = await resolveGenericEdgeTargetSnapshot({
    environment: {
      GENERIC_EDGE_MEDIA_DEVICE_ID: 'generic-orin',
      GENERIC_EDGE_MEDIA_ALLOWED_CIDRS: '10.2.0.0/16',
      GENERIC_ENDPOINT_REGISTRY_DIR: '/safe/registry',
      EDGE_MEDIA_CONTROL_TOKEN: 'control-secret',
      EDGE_MEDIA_URL: 'http://attacker.invalid:9999/ignored',
    },
    loadLeaseConfig: () => leaseConfig,
    resolveLease: async (config) => {
      events.push(config);
      return {
        deviceId: 'generic-orin',
        instanceId: '11111111-2222-4333-8444-555555555555',
        address: '10.2.2.199',
        receivedAt: '2026-08-24T10:00:00.000Z',
        expiresAt: '2026-08-24T10:00:45.000Z',
      };
    },
  });

  assert.deepEqual(events, [leaseConfig]);
  assert.deepEqual(target, {
    startUrl: 'http://10.2.2.199:8013/start',
    stopUrl: 'http://10.2.2.199:8013/stop',
    controlToken: 'control-secret',
    deviceId: 'generic-orin',
    address: '10.2.2.199',
  });
  assert.equal(Object.isFrozen(target), true);
});

test('control requests reconstruct the fixed target and redact response bodies', async () => {
  const calls = [];
  const target = {
    startUrl: 'http://attacker.invalid/start',
    stopUrl: 'http://attacker.invalid/stop',
    controlToken: 'control-secret',
    deviceId: 'generic-orin',
    address: '10.2.2.199',
  };
  await requestGenericEdgeControl('start', { session_id: 'session-1' }, target, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    },
  });

  assert.equal(calls[0].url, 'http://10.2.2.199:8013/start');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.headers['X-Lexvoice-Control-Token'], 'control-secret');

  await assert.rejects(
    requestGenericEdgeControl('stop', { session_id: 'session-1' }, target, {
      fetchImpl: async () => new Response('control-secret room-token', { status: 403 }),
    }),
    (error) => {
      assert.match(error.message, /HTTP 403/);
      assert.doesNotMatch(error.message, /control-secret|room-token/);
      return true;
    }
  );
});

test('room input token is room-scoped and expires after 15 minutes', async () => {
  const token = await createGenericRoomInputToken('voice_assistant_room_session-1', {
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'devsecret-devsecret-devsecret-dev',
  });
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

  assert.equal(claims.sub, 'room_audio_input');
  assert.ok(claims.exp - Math.floor(Date.now() / 1000) >= 899);
  assert.ok(claims.exp - Math.floor(Date.now() / 1000) <= 900);
  assert.equal(claims.video.room, 'voice_assistant_room_session-1');
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canPublish, true);
  assert.equal(claims.video.canSubscribe, true);
  assert.equal(claims.video.canPublishData, true);
});

test('production coordinator dispatches the Agent before resolving and controlling Edge', async () => {
  const events = [];
  const target = Object.freeze({
    startUrl: 'http://10.2.2.199:8013/start',
    stopUrl: 'http://10.2.2.199:8013/stop',
    controlToken: 'secret',
    deviceId: 'generic-orin',
    address: '10.2.2.199',
  });
  const result = await coordinateGenericRoomSession(
    {
      roomUrl: 'ws://livekit.test',
      roomName: 'room-1',
      sessionId: 'session-1',
      agentName: 'lexvoice-generic-agent',
    },
    {
      dispatchAgent: async () => {
        events.push('agent');
        return { agentParticipant: { identity: 'agent-joined' } };
      },
      resolveTarget: async () => {
        events.push('lease');
        return target;
      },
      pairEndpoint: async (_request, resolvedTarget) => {
        events.push(`edge:${resolvedTarget.address}`);
        return { deviceId: resolvedTarget.deviceId, address: resolvedTarget.address };
      },
    }
  );

  assert.deepEqual(events, ['agent', 'lease', 'edge:10.2.2.199']);
  assert.deepEqual(result.edge, { deviceId: 'generic-orin', address: '10.2.2.199' });
});

test('production coordinator awaits cloud cleanup after a post-Agent pairing failure', async () => {
  const events = [];
  await assert.rejects(
    coordinateGenericRoomSession(
      {
        roomUrl: 'ws://livekit.test',
        roomName: 'room-1',
        sessionId: 'session-1',
        agentName: 'lexvoice-generic-agent',
      },
      {
        dispatchAgent: async () => {
          events.push('agent');
          return { agentParticipant: { identity: 'agent-joined' } };
        },
        resolveTarget: async () => {
          events.push('lease');
          return {
            startUrl: 'http://10.2.2.199:8013/start',
            stopUrl: 'http://10.2.2.199:8013/stop',
            controlToken: 'secret',
            deviceId: 'generic-orin',
            address: '10.2.2.199',
          };
        },
        pairEndpoint: async () => {
          events.push('edge');
          throw new Error('media readiness timeout');
        },
        cleanupSession: async () => {
          events.push('cloud-cleanup');
        },
      }
    ),
    /media readiness timeout/
  );
  assert.deepEqual(events, ['agent', 'lease', 'edge', 'cloud-cleanup']);
});

test('production coordinator cleans the Agent Room when dispatch fails after a partial create', async () => {
  const events = [];
  await assert.rejects(
    coordinateGenericRoomSession(
      {
        roomUrl: 'ws://livekit.test',
        roomName: 'room-1',
        sessionId: 'session-1',
        agentName: 'lexvoice-generic-agent',
      },
      {
        dispatchAgent: async () => {
          events.push('agent');
          throw new Error('dispatch response lost');
        },
        resolveTarget: async () => assert.fail('lease must not resolve after dispatch failure'),
        pairEndpoint: async () => assert.fail('Edge must not start after dispatch failure'),
        cleanupSession: async () => {
          events.push('cloud-cleanup');
        },
      }
    ),
    /dispatch response lost/
  );
  assert.deepEqual(events, ['agent', 'cloud-cleanup']);
});

test('production coordinator cleans the Agent Room when lease resolution fails closed', async () => {
  const events = [];
  await assert.rejects(
    coordinateGenericRoomSession(
      {
        roomUrl: 'ws://livekit.test',
        roomName: 'room-1',
        sessionId: 'session-1',
        agentName: 'lexvoice-generic-agent',
      },
      {
        dispatchAgent: async () => {
          events.push('agent');
          return { agentParticipant: { identity: 'agent-joined' } };
        },
        resolveTarget: async () => {
          events.push('lease');
          throw new Error('Generic endpoint lease is unavailable');
        },
        pairEndpoint: async () => assert.fail('Edge must not be called without a lease'),
        cleanupSession: async () => {
          events.push('cloud-cleanup');
        },
      }
    ),
    /lease is unavailable/
  );
  assert.deepEqual(events, ['agent', 'lease', 'cloud-cleanup']);
});

test('production coordinator cleans the Agent Room when dispatch returns no identity', async () => {
  const events = [];
  await assert.rejects(
    coordinateGenericRoomSession(
      {
        roomUrl: 'ws://livekit.test',
        roomName: 'room-1',
        sessionId: 'session-1',
        agentName: 'lexvoice-generic-agent',
      },
      {
        dispatchAgent: async () => {
          events.push('agent');
          return { agentParticipant: {} };
        },
        resolveTarget: async () => assert.fail('lease must not resolve without Agent identity'),
        pairEndpoint: async () => assert.fail('Edge must not start without Agent identity'),
        cleanupSession: async () => {
          events.push('cloud-cleanup');
        },
      }
    ),
    /Agent participant is unavailable/
  );
  assert.deepEqual(events, ['agent', 'cloud-cleanup']);
});

test('explicit Generic stop resolves the current lease and treats control failure as material', async () => {
  const events = [];
  await assert.rejects(
    stopGenericEdgeMedia(
      { roomName: 'room-1', sessionId: 'session-1' },
      {
        resolveTarget: async () => {
          events.push('lease');
          return {
            startUrl: 'http://10.2.2.200:8013/start',
            stopUrl: 'http://10.2.2.200:8013/stop',
            controlToken: 'secret',
            deviceId: 'generic-orin',
            address: '10.2.2.200',
          };
        },
        requestControl: async (action, payload, target) => {
          events.push(`${action}:${target.address}:${payload.session_id}`);
          throw new Error('Edge stop returned HTTP 500');
        },
      }
    ),
    /HTTP 500/
  );
  assert.deepEqual(events, ['lease', 'stop:10.2.2.200:session-1']);
});
