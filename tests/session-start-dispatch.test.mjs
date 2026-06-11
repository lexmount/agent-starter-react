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

test('session dispatch route only accepts explicitly named agent participants as already joined', async () => {
  const routeSource = await readFile(
    new URL('../app/api/session/dispatch/route.ts', import.meta.url),
    'utf8'
  );
  const participantMatcher = routeSource.match(/function isExpectedAgentParticipant[\s\S]*?\n}/);

  assert.ok(participantMatcher, 'isExpectedAgentParticipant should be defined');
  const participantMatcherSource = participantMatcher[0];
  assert.match(participantMatcherSource, /attributes\['lk\.agent\.name'\] === agentName/);
  assert.match(participantMatcherSource, /attributes\['lk\.agent_name'\] === agentName/);
  assert.doesNotMatch(participantMatcherSource, /identity\.startsWith\(['"]agent-['"]\)/);
});

test('start call dispatches the agent with a cancellable room session id', async () => {
  const useRoomSource = await readFile(new URL('../hooks/useRoom.ts', import.meta.url), 'utf8');

  assert.match(useRoomSource, /const startSession = useCallback\(async \(\) =>/);
  assert.match(useRoomSource, /crypto\.randomUUID\(\)/);
  assert.match(useRoomSource, /beginAgentSessionStart/);
  assert.match(useRoomSource, /registerAgentSessionDispatch/);
  assert.match(useRoomSource, /requestAgentSessionDispatch/);
  assert.match(useRoomSource, /await dispatchPromise/);
  assert.match(useRoomSource, /isExpectedStartCancellation/);
  assert.match(useRoomSource, /waitForAgentSessionStop/);
  assert.match(
    useRoomSource,
    /requestAgentSessionDispatch\(\s*room\.name,\s*appConfig\.agentName,\s*sessionId,/
  );
});

test('browser video input shows the camera control as enabled by default', async () => {
  const browserSourceSource = await readFile(
    new URL('../hooks/useBrowserSourceClient.ts', import.meta.url),
    'utf8'
  );
  const controlBarSource = await readFile(
    new URL('../components/livekit/agent-control-bar/agent-control-bar.tsx', import.meta.url),
    'utf8'
  );

  assert.match(browserSourceSource, /const BROWSER_VIDEO_DEFAULT_ENABLED = true/);
  assert.match(
    controlBarSource,
    /mediaEnabled=\{usesBrowserRawVideoInput \? browserSourceClient\.videoEnabled : undefined\}/
  );
});
