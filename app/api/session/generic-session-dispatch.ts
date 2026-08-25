import {
  type GenericEdgeTargetSnapshot,
  type GenericPairingRequest,
  coordinateGenericRoomSession,
  createGenericRoomInputToken,
  isGenericEndpointPairingEnabled,
  pairGenericEdgeMedia,
  requestGenericEdgeControl,
  resolveGenericEdgeTargetSnapshot,
} from '@/app/api/session/generic-edge-media-pairing';
import { markGenericFailedStartCleanupRequest } from '@/app/api/session/generic-failed-start-cleanup';
import {
  RoomSessionCancelledError,
  dispatchRoomSession,
  waitForExistingRoomSessionReadiness,
} from '@/app/api/session/session-dispatch-service';
import { getRoomSessionSnapshot } from '@/app/api/session/session-registry';
import { POST as stopSession } from '@/app/api/session/stop/route';

type Environment = Record<string, string | undefined>;

type RunSessionDispatchRequest = {
  roomName: string;
  sessionId: string;
  agentName: string;
  requireRoomVideoInputReady?: boolean;
};

type RunSessionDispatchDependencies = {
  environment?: Environment;
  dispatchAgent?: () => Promise<{ agentParticipant?: { identity?: string } }>;
  resolveTarget?: () => Promise<GenericEdgeTargetSnapshot>;
  pairEndpoint?: (
    request: GenericPairingRequest,
    target: GenericEdgeTargetSnapshot
  ) => Promise<{ deviceId: string; address: string }>;
};

export async function cleanupFailedGenericRoomSession(
  roomName: string,
  sessionId: string
): Promise<void> {
  const request = markGenericFailedStartCleanupRequest(
    new Request('http://localhost/api/session/stop', {
      method: 'POST',
      body: JSON.stringify({ roomName, sessionId, wait: true }),
    })
  );
  const response = await stopSession(request);
  const payload = (await response.json()) as {
    results?: Array<{ ok?: boolean; skipped?: boolean }>;
  };
  const cleanupUnconfirmed =
    !Array.isArray(payload.results) ||
    payload.results.some((result) => result.ok !== true && result.skipped !== true);
  if (!response.ok || cleanupUnconfirmed) {
    throw new Error('Generic failed-start cloud cleanup could not be confirmed');
  }
}

export async function runSessionDispatch(
  request: RunSessionDispatchRequest,
  dependencies: RunSessionDispatchDependencies = {}
) {
  const environment = dependencies.environment ?? process.env;
  const dispatchAgent =
    dependencies.dispatchAgent ??
    (() =>
      dispatchRoomSession({
        roomName: request.roomName,
        sessionId: request.sessionId,
        agentName: request.agentName,
        readiness: isGenericEndpointPairingEnabled(environment)
          ? {}
          : { requireRoomVideoInputReady: request.requireRoomVideoInputReady === true },
      }));
  if (!isGenericEndpointPairingEnabled(environment)) {
    return dispatchAgent();
  }

  const roomUrl =
    (environment.LIVEKIT_BROWSER_URL ?? '').trim() || (environment.LIVEKIT_URL ?? '').trim();
  if (!roomUrl) {
    throw new Error('LIVEKIT_BROWSER_URL or LIVEKIT_URL is required for Generic endpoint pairing');
  }
  return coordinateGenericRoomSession(
    { ...request, roomUrl },
    {
      dispatchAgent,
      resolveTarget:
        dependencies.resolveTarget ?? (() => resolveGenericEdgeTargetSnapshot({ environment })),
      pairEndpoint:
        dependencies.pairEndpoint ??
        ((pairingRequest, target) =>
          pairGenericEdgeMedia(pairingRequest, {
            config: target,
            createRoomToken: () => createGenericRoomInputToken(request.roomName, environment),
            requestControl: requestGenericEdgeControl,
            waitForReadiness: () =>
              waitForExistingRoomSessionReadiness(
                { roomName: request.roomName, agentName: request.agentName },
                {
                  isCancelled: () => getRoomSessionSnapshot(request.roomName)?.cancelled === true,
                }
              ),
            isCancelled: () => getRoomSessionSnapshot(request.roomName)?.cancelled === true,
          })),
      cleanupSession: () => cleanupFailedGenericRoomSession(request.roomName, request.sessionId),
    }
  );
}

export function formatSessionDispatchError(
  error: unknown,
  environment: Environment = process.env
): string {
  if (isGenericEndpointPairingEnabled(environment)) {
    return 'Generic session startup failed';
  }
  return error instanceof Error ? error.message : String(error);
}

export { RoomSessionCancelledError };
