import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import {
  beginPrewarmUse,
  buildPrewarmUseKey,
  completePrewarmUse,
  failPrewarmUse,
} from '@/app/api/session/prewarm/prewarm-use-guard';
import { prewarmRoomSession } from '@/app/api/session/session-dispatch-service';
import { deriveLiveKitRoomName, isValidConnectionRoomId } from '@/lib/connection-room-id';

export const runtime = 'nodejs';
export const revalidate = 0;

function secretsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export async function POST(request: Request) {
  const expectedSecret = (process.env.LIVEAVATAR_PREWARM_SECRET || '').trim();
  const actualSecret = (request.headers.get('x-liveavatar-prewarm-secret') || '').trim();
  if (!expectedSecret || !actualSecret || !secretsMatch(actualSecret, expectedSecret)) {
    return NextResponse.json({ status: 'error', error: 'unauthorized' }, { status: 401 });
  }

  const sessionId = (process.env.LIVEAVATAR_VOICE_SESSION_ID || '').trim();
  const agentName = (process.env.AGENT_NAME || '').trim();
  const configuredRoomName = (process.env.LIVEAVATAR_LIVEKIT_ROOM_NAME || '').trim();
  const roomName = isValidConnectionRoomId(sessionId) ? deriveLiveKitRoomName(sessionId) : '';

  if (!sessionId || !roomName || configuredRoomName !== roomName || !agentName) {
    return NextResponse.json(
      { status: 'error', error: 'server-owned prewarm identity is not configured' },
      { status: 503 }
    );
  }

  const prewarmUseKey = buildPrewarmUseKey(sessionId, roomName, agentName);
  const prewarmUseState = beginPrewarmUse(prewarmUseKey);
  if (prewarmUseState !== 'started') {
    return NextResponse.json(
      {
        status: 'error',
        error:
          prewarmUseState === 'in_progress'
            ? 'prewarm already in progress'
            : 'prewarm authorization already consumed',
      },
      { status: 409, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const result = await prewarmRoomSession({ roomName, sessionId, agentName });
    completePrewarmUse(prewarmUseKey);
    return NextResponse.json(
      { status: 'prewarmed', roomName, sessionId, agentName, ...result },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    failPrewarmUse(prewarmUseKey);
    return NextResponse.json(
      {
        status: 'error',
        roomName,
        sessionId,
        agentName,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}
