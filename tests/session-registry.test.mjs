import assert from 'node:assert/strict';
import { test } from 'node:test';

async function loadRegistryModule() {
  return import('../app/api/session/session-registry.ts');
}

function assertSnapshotMatches(actual, expected) {
  assert.equal(actual.roomName, expected.roomName);
  assert.equal(actual.sessionId, expected.sessionId);
  assert.equal(actual.agentName, expected.agentName);
  assert.equal(typeof actual.generation, 'number');
  assert.equal(actual.state, expected.state);
  assert.equal(actual.cancelled, expected.cancelled);
  assert.deepEqual(actual.dispatchIds, expected.dispatchIds);
}

test('session registry tracks dispatch ids for the active room session', async () => {
  const registry = await loadRegistryModule();
  const session = registry.beginRoomSessionDispatch('room-a', 'session-1', 'agent-a');

  registry.registerRoomSessionDispatchId(session, 'dispatch-1');

  assertSnapshotMatches(registry.getRoomSessionSnapshot('room-a'), {
    roomName: 'room-a',
    sessionId: 'session-1',
    agentName: 'agent-a',
    state: 'starting',
    cancelled: false,
    dispatchIds: ['dispatch-1'],
  });
});

test('session registry marks an in-flight dispatch cancelled before cleanup', async () => {
  const registry = await loadRegistryModule();
  const session = registry.beginRoomSessionDispatch('room-a', 'session-1', 'agent-a');
  registry.registerRoomSessionDispatchId(session, 'dispatch-1');

  const stopping = registry.markRoomSessionStopping('room-a', 'session-1');

  assert.equal(registry.isRoomSessionCancelled(session), true);
  assert.equal(stopping.cancelled, true);
  assert.deepEqual(stopping.dispatchIds, ['dispatch-1']);
});

test('session registry stop barrier waits for active dispatch to finish', async () => {
  const registry = await loadRegistryModule();
  const session = registry.beginRoomSessionDispatch('room-a', 'session-1', 'agent-a');

  registry.markRoomSessionStopping('room-a', 'session-1');

  let resolved = false;
  const barrier = registry
    .waitForRoomSessionDispatchesToFinish('room-a', 'session-1', 1000)
    .then(() => {
      resolved = true;
    });

  await Promise.resolve();
  assert.equal(resolved, false);

  registry.finishRoomSessionDispatch(session);
  await barrier;
  assert.equal(resolved, true);
});
