import { AccessToken, type VideoGrant } from 'livekit-server-sdk';
import {
  buildGenericEdgeControlUrl,
  loadGenericEndpointLeaseConfig,
  resolveActiveGenericEndpointLease,
} from '@/lib/generic-endpoint-lease';

export type GenericEdgeTargetSnapshot = Readonly<{
  startUrl: string;
  stopUrl: string;
  controlToken: string;
  deviceId: string;
  address: string;
}>;

export type GenericPairingRequest = {
  roomUrl: string;
  roomName: string;
  sessionId: string;
  controlSenderIdentity: string;
};

type ControlAction = 'start' | 'stop';

type Environment = Record<string, string | undefined>;

type TargetResolutionDependencies = {
  environment?: Environment;
  loadLeaseConfig?: typeof loadGenericEndpointLeaseConfig;
  resolveLease?: typeof resolveActiveGenericEndpointLease;
};

type ControlRequestDependencies = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type GenericSessionCoordinatorRequest = Omit<GenericPairingRequest, 'controlSenderIdentity'> & {
  agentName: string;
};

type GenericSessionCoordinatorDependencies = {
  dispatchAgent: () => Promise<{ agentParticipant?: { identity?: string } }>;
  resolveTarget: () => Promise<GenericEdgeTargetSnapshot>;
  pairEndpoint: (
    request: GenericPairingRequest,
    target: GenericEdgeTargetSnapshot
  ) => Promise<{ deviceId: string; address: string }>;
  cleanupSession?: () => Promise<unknown>;
};

type GenericStopDependencies = {
  resolveTarget: () => Promise<GenericEdgeTargetSnapshot>;
  requestControl: (
    action: ControlAction,
    payload: Record<string, unknown>,
    target: GenericEdgeTargetSnapshot
  ) => Promise<unknown>;
};

type GenericPairingDependencies = {
  config: GenericEdgeTargetSnapshot;
  createRoomToken: () => Promise<string>;
  requestControl: (
    action: ControlAction,
    payload: Record<string, unknown>,
    config: GenericEdgeTargetSnapshot
  ) => Promise<unknown>;
  waitForReadiness: () => Promise<unknown>;
  isCancelled?: () => boolean;
};

export async function pairGenericEdgeMedia(
  request: GenericPairingRequest,
  dependencies: GenericPairingDependencies
) {
  const target = Object.freeze({ ...dependencies.config });
  const stopPayload = {
    room_name: request.roomName,
    session_id: request.sessionId,
  };
  await dependencies.requestControl('stop', stopPayload, target);

  const roomToken = await dependencies.createRoomToken();
  const startPayload = {
    room_url: request.roomUrl,
    room_token: roomToken,
    room_name: request.roomName,
    session_id: request.sessionId,
    service_instance_id: target.deviceId,
    source_type: 'generic',
    control_sender_identity: request.controlSenderIdentity,
    participant_identity: 'room_audio_input',
    track_names: { audio: 'room_audio', video: 'room_video_raw' },
  };

  let startAttempted = false;
  try {
    startAttempted = true;
    await dependencies.requestControl('start', startPayload, target);
    await dependencies.waitForReadiness();
    if (dependencies.isCancelled?.()) {
      throw new Error('Generic endpoint pairing was cancelled');
    }
    return { deviceId: target.deviceId, address: target.address };
  } catch (error) {
    if (startAttempted) {
      try {
        await dependencies.requestControl('stop', stopPayload, target);
      } catch {
        throw new Error('Generic endpoint pairing failed and rollback could not be confirmed', {
          cause: error,
        });
      }
    }
    throw error;
  }
}

export function isGenericEndpointPairingEnabled(environment: Environment = process.env): boolean {
  const inputSource = readEnvironmentValue(environment, [
    'INPUT_SOURCE',
    'NEXT_PUBLIC_INPUT_SOURCE',
    'NEXT_PUBLIC_LEXVOICE_DEVICE',
  ]).toLowerCase();
  if (inputSource === 'generic') {
    return true;
  }
  if (inputSource !== 'mixed') {
    return false;
  }
  return ['ROOM_AUDIO_INPUT_DEVICE', 'ROOM_VISION_INPUT_DEVICE'].some(
    (name) =>
      readEnvironmentValue(environment, [name, `NEXT_PUBLIC_${name}`]).toLowerCase() === 'generic'
  );
}

export async function resolveGenericEdgeTargetSnapshot(
  dependencies: TargetResolutionDependencies = {}
): Promise<GenericEdgeTargetSnapshot> {
  const environment = dependencies.environment ?? process.env;
  const loadLeaseConfig = dependencies.loadLeaseConfig ?? loadGenericEndpointLeaseConfig;
  const resolveLease = dependencies.resolveLease ?? resolveActiveGenericEndpointLease;
  const lease = await resolveLease(loadLeaseConfig(environment));
  const controlToken = (environment.EDGE_MEDIA_CONTROL_TOKEN ?? '').trim();
  if (!controlToken) {
    throw new Error('EDGE_MEDIA_CONTROL_TOKEN is required for Generic endpoint control');
  }
  return Object.freeze({
    startUrl: buildGenericEdgeControlUrl(lease, 'start'),
    stopUrl: buildGenericEdgeControlUrl(lease, 'stop'),
    controlToken,
    deviceId: lease.deviceId,
    address: lease.address,
  });
}

export async function requestGenericEdgeControl(
  action: ControlAction,
  payload: Record<string, unknown>,
  target: GenericEdgeTargetSnapshot,
  dependencies: ControlRequestDependencies = {}
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? 3_000);
  try {
    const response = await (dependencies.fetchImpl ?? fetch)(
      buildGenericEdgeControlUrl(target, action),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Lexvoice-Control-Token': target.controlToken,
        },
        body: JSON.stringify(payload),
        redirect: 'manual',
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      throw new Error(`Generic endpoint ${action} returned HTTP ${response.status}`);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      /^Generic endpoint (start|stop) returned HTTP/.test(error.message)
    ) {
      throw error;
    }
    throw new Error(`Generic endpoint ${action} request failed`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function createGenericRoomInputToken(
  roomName: string,
  environment: Environment = process.env
): Promise<string> {
  const apiKey = (environment.LIVEKIT_API_KEY ?? '').trim();
  const apiSecret = (environment.LIVEKIT_API_SECRET ?? '').trim();
  if (!apiKey || !apiSecret) {
    throw new Error('LiveKit API configuration is required for Generic endpoint pairing');
  }
  const token = new AccessToken(apiKey, apiSecret, {
    identity: 'room_audio_input',
    name: 'Generic Edge Media',
    ttl: '15m',
  });
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  token.addGrant(grant);
  return token.toJwt();
}

export async function coordinateGenericRoomSession(
  request: GenericSessionCoordinatorRequest,
  dependencies: GenericSessionCoordinatorDependencies
) {
  const dispatch = await dependencies.dispatchAgent();
  try {
    const controlSenderIdentity = dispatch.agentParticipant?.identity?.trim();
    if (!controlSenderIdentity) {
      throw new Error('Generic session Agent participant is unavailable');
    }
    const target = await dependencies.resolveTarget();
    const edge = await dependencies.pairEndpoint(
      {
        roomUrl: request.roomUrl,
        roomName: request.roomName,
        sessionId: request.sessionId,
        controlSenderIdentity,
      },
      target
    );
    return { dispatch, edge };
  } catch (error) {
    try {
      await dependencies.cleanupSession?.();
    } catch {
      throw new Error('Generic session startup failed and cloud cleanup could not be confirmed', {
        cause: error,
      });
    }
    throw error;
  }
}

export async function stopGenericEdgeMedia(
  request: { roomName: string; sessionId: string },
  dependencies: GenericStopDependencies
) {
  const target = await dependencies.resolveTarget();
  await dependencies.requestControl(
    'stop',
    { room_name: request.roomName, session_id: request.sessionId },
    target
  );
  return { deviceId: target.deviceId, address: target.address };
}

function readEnvironmentValue(environment: Environment, names: string[]): string {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value) {
      return value;
    }
  }
  return '';
}
