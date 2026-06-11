import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('connection details route does not dispatch agents while generating tokens', async () => {
  const routeSource = await readFile(
    new URL('../app/api/connection-details/route.ts', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(routeSource, /AgentDispatchClient/);
  assert.doesNotMatch(routeSource, /RoomServiceClient/);
  assert.doesNotMatch(routeSource, /createRoomAndDispatchAgent/);
  assert.doesNotMatch(routeSource, /createAgentDispatchWithRetry/);
  assert.doesNotMatch(routeSource, /dispatchClient\.createDispatch/);
});

test('connection details route strips room-config agents from the participant token', async () => {
  const routeSource = await readFile(
    new URL('../app/api/connection-details/route.ts', import.meta.url),
    'utf8'
  );

  assert.match(routeSource, /function buildTokenRoomConfig/);
  assert.match(routeSource, /RoomConfiguration\.fromJson/);
  assert.match(routeSource, /agents: \[\]/);
  assert.match(routeSource, /resolveConnectionRoomId/);
});

test('session dispatch route retries explicit agent dispatch after the browser joins', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/dispatch/route.ts', import.meta.url),
    'utf8'
  );

  assert.match(routeSource, /AgentDispatchClient/);
  assert.match(routeSource, /RoomServiceClient/);
  assert.match(routeSource, /AGENT_DISPATCH_TIMEOUT_MS/);
  assert.match(routeSource, /AGENT_DISPATCH_RETRY_MS/);
  assert.match(routeSource, /roomHasAgentParticipant/);
  assert.match(routeSource, /deleteDispatchQuietly/);
  assert.match(routeSource, /dispatchClient\.createDispatch/);
  assert.match(routeSource, /roomName is required/);
  assert.match(routeSource, /agentName is required/);
  assert.match(routeSource, /sessionId is required/);
  assert.match(routeSource, /beginRoomSessionDispatch/);
  assert.match(routeSource, /registerRoomSessionDispatchId/);
  assert.match(routeSource, /isRoomSessionCancelled/);
  assert.match(routeSource, /markRoomSessionRunning/);
  assert.match(routeSource, /finishRoomSessionDispatch/);
});

test('session dispatch route cleans up dispatch when the room session is cancelled', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/dispatch/route.ts', import.meta.url),
    'utf8'
  );

  assert.match(routeSource, /class RoomSessionCancelledError extends Error/);
  assert.match(routeSource, /throwIfSessionCancelled/);
  assert.match(
    routeSource,
    /await deleteDispatchQuietly\(dispatchClient,\s*dispatch\.id,\s*roomName\)/
  );
  assert.match(routeSource, /await deleteLiveKitRoomQuietly\(roomClient,\s*roomName\)/);
  assert.match(routeSource, /status: 409/);
});

test('start call dispatches the agent with a cancellable room session id', async () => {
  const useRoomSource = await readFile(new URL('../hooks/useRoom.ts', import.meta.url), 'utf8');

  assert.match(useRoomSource, /crypto\.randomUUID\(\)/);
  assert.match(useRoomSource, /beginAgentSessionStart/);
  assert.match(useRoomSource, /registerAgentSessionDispatch/);
  assert.match(useRoomSource, /requestAgentSessionDispatch/);
  assert.match(useRoomSource, /waitForAgentSessionStop/);
  assert.match(
    useRoomSource,
    /requestAgentSessionDispatch\(\s*room\.name,\s*appConfig\.agentName,\s*sessionId,/
  );
});
