import { NextResponse } from 'next/server';
import { AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';
import {
  buildRoomInputStopPayload,
  resolveLiveKitHttpUrl,
  resolveRoomInputStopUrl,
} from '@/lib/session-stop';
import {
  markRoomSessionStopped,
  markRoomSessionStopping,
  waitForRoomSessionDispatchesToFinish,
} from '../session-registry';

const ROOM_INPUT_STOP_TIMEOUT_MS = readPositiveIntEnv('ROOM_INPUT_STOP_TIMEOUT_MS', 12_000);
const AGENT_DISPATCH_STOP_BARRIER_MS = readPositiveIntEnv('AGENT_DISPATCH_STOP_BARRIER_MS', 2_000);

type StopResult = {
  target: string;
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
  dispatch_ids?: string[];
};

export const revalidate = 0;

type StopRequestBody = {
  roomName?: string;
  room_name?: string;
  sessionId?: string;
  session_id?: string;
  wait?: boolean | string | number;
};

async function stopRoomInput(roomName: string): Promise<StopResult> {
  const stopUrl = resolveRoomInputStopUrl(process.env.ROOM_INPUT_URL);
  if (!stopUrl) {
    return { target: 'room_input', ok: true, skipped: true };
  }

  try {
    const response = await fetch(stopUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRoomInputStopPayload(roomName)),
      signal: AbortSignal.timeout(ROOM_INPUT_STOP_TIMEOUT_MS),
    });
    return {
      target: 'room_input',
      ok: response.ok,
      status: response.status,
      error: response.ok ? undefined : await response.text(),
    };
  } catch (error) {
    return {
      target: 'room_input',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readStopInputSource(): string {
  return (
    process.env.INPUT_SOURCE ||
    process.env.NEXT_PUBLIC_INPUT_SOURCE ||
    process.env.NEXT_PUBLIC_LEXVOICE_DEVICE ||
    ''
  )
    .trim()
    .toLowerCase();
}

function requestWaitsForRemoteCleanup(body: StopRequestBody): boolean {
  const wait = body.wait;
  if (typeof wait === 'boolean') {
    return wait;
  }
  if (typeof wait === 'number') {
    return wait !== 0;
  }
  if (typeof wait === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(wait.trim().toLowerCase());
  }
  return false;
}

function shouldDeferRemoteSessionCleanup(body: StopRequestBody): boolean {
  if (requestWaitsForRemoteCleanup(body)) {
    return false;
  }
  return readStopInputSource() === 'browser';
}

async function deleteLiveKitRoom(roomName: string): Promise<StopResult> {
  const liveKitHttpUrl = resolveLiveKitHttpUrl(process.env.LIVEKIT_URL);
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!liveKitHttpUrl || !apiKey || !apiSecret) {
    return { target: 'livekit_room', ok: true, skipped: true };
  }

  try {
    const roomService = new RoomServiceClient(liveKitHttpUrl, apiKey, apiSecret);
    await roomService.deleteRoom(roomName);
    return { target: 'livekit_room', ok: true };
  } catch (error) {
    return {
      target: 'livekit_room',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function cancelPendingDispatches(
  roomName: string,
  dispatchIds: string[]
): Promise<StopResult> {
  const liveKitHttpUrl = resolveLiveKitHttpUrl(process.env.LIVEKIT_URL);
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!liveKitHttpUrl || !apiKey || !apiSecret || dispatchIds.length === 0) {
    return {
      target: 'agent_dispatch',
      ok: true,
      skipped: dispatchIds.length === 0,
      dispatch_ids: dispatchIds,
    };
  }

  const dispatchClient = new AgentDispatchClient(liveKitHttpUrl, apiKey, apiSecret);
  await Promise.all(
    dispatchIds.map(async (dispatchId) => {
      try {
        await dispatchClient.deleteDispatch(dispatchId, roomName);
      } catch {
        // The dispatch may already have been consumed, deleted by retry cleanup, or cancelled by LiveKit.
      }
    })
  );

  return {
    target: 'agent_dispatch',
    ok: true,
    dispatch_ids: dispatchIds,
  };
}

async function waitForPendingDispatches(roomName: string, sessionId: string): Promise<StopResult> {
  await waitForRoomSessionDispatchesToFinish(roomName, sessionId, AGENT_DISPATCH_STOP_BARRIER_MS);
  return { target: 'agent_dispatch_barrier', ok: true };
}

async function runRemoteSessionCleanup(
  roomName: string,
  sessionId: string,
  dispatchResult: StopResult,
  dispatchIds: string[]
): Promise<{ results: StopResult[]; failures: StopResult[] }> {
  const dispatchBarrierResult = await waitForPendingDispatches(roomName, sessionId);
  const [roomInputResult, liveKitRoomResult] = await Promise.all([
    stopRoomInput(roomName),
    deleteLiveKitRoom(roomName),
  ]);
  const cleanupResults = [dispatchBarrierResult, roomInputResult, liveKitRoomResult];
  const results = [
    {
      target: 'session_registry',
      ok: true,
      dispatch_ids: dispatchIds,
    },
    dispatchResult,
    ...cleanupResults,
  ];
  const failures = results.filter((result) => !result.ok && !result.skipped);
  if (failures.length === 0) {
    markRoomSessionStopped(roomName, sessionId);
  }
  return { results, failures };
}

export async function POST(req: Request) {
  let body: StopRequestBody;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const roomName = (body.roomName || body.room_name || '').trim();
  const sessionId = (body.sessionId || body.session_id || '').trim();
  if (!roomName) {
    return NextResponse.json({ status: 'error', error: 'roomName is required' }, { status: 400 });
  }

  const stoppingSession = markRoomSessionStopping(roomName, sessionId);
  const dispatchResult = await cancelPendingDispatches(roomName, stoppingSession.dispatchIds);
  if (shouldDeferRemoteSessionCleanup(body)) {
    void runRemoteSessionCleanup(roomName, sessionId, dispatchResult, stoppingSession.dispatchIds)
      .then(({ failures }) => {
        if (failures.length > 0) {
          console.error('deferred agent session stop completed with failures', {
            roomName,
            sessionId,
            failures,
          });
        }
      })
      .catch((error) => {
        console.error('deferred agent session stop failed', {
          roomName,
          sessionId,
          error,
        });
      });

    return NextResponse.json(
      {
        status: 'stopping',
        roomName,
        sessionId,
        results: [
          {
            target: 'session_registry',
            ok: true,
            dispatch_ids: stoppingSession.dispatchIds,
          },
          dispatchResult,
          { target: 'remote_cleanup', ok: true, status: 202 },
        ],
      },
      { status: 202 }
    );
  }

  const { results, failures } = await runRemoteSessionCleanup(
    roomName,
    sessionId,
    dispatchResult,
    stoppingSession.dispatchIds
  );
  return NextResponse.json(
    {
      status: failures.length === 0 ? 'stopped' : 'partial',
      roomName,
      sessionId,
      results,
    },
    { status: failures.length === 0 ? 200 : 502 }
  );
}
