import assert from 'node:assert/strict';
import { test } from 'node:test';

const { bindRemoteParticipantLifecycle, createRemoteAudioTrackLifecycle } = await import(
  '../lib/remote-audio-track-lifecycle.ts'
);

const agentA = {
  trackSid: 'TR_A',
  participantIdentity: 'agent',
  trackName: 'roomio_audio',
  payload: { id: 'media-a' },
};

const agentBackup = {
  trackSid: 'TR_B',
  participantIdentity: 'agent-backup',
  trackName: 'roomio_audio',
  payload: { id: 'media-b' },
};

const agentC = {
  trackSid: 'TR_C',
  participantIdentity: 'agent',
  trackName: 'assistant_audio',
  payload: { id: 'media-c' },
};

function createHarness() {
  const attached = [];
  const detached = [];
  const lifecycle = createRemoteAudioTrackLifecycle({
    attach: (entry) => attached.push(entry.trackSid),
    detach: (entry) => detached.push(entry.trackSid),
  });

  return { attached, detached, lifecycle };
}

test('equivalent reconcile snapshots do not churn retained tracks', () => {
  const { attached, detached, lifecycle } = createHarness();

  lifecycle.reconcile([agentA, agentBackup]);
  assert.deepEqual(attached, ['TR_A', 'TR_B']);
  assert.deepEqual(detached, []);

  attached.length = 0;
  lifecycle.reconcile([{ ...agentA }, { ...agentBackup }]);

  assert.deepEqual(attached, []);
  assert.deepEqual(detached, []);
});

test('changed reconcile snapshots only detach newly excluded and attach newly allowed tracks', () => {
  const { attached, detached, lifecycle } = createHarness();

  lifecycle.reconcile([agentA, agentBackup]);
  attached.length = 0;

  lifecycle.reconcile([agentBackup, agentC]);

  assert.deepEqual(attached, ['TR_C']);
  assert.deepEqual(detached, ['TR_A']);
});

test('same-name tracks with different SIDs remain independent', () => {
  const { attached, detached, lifecycle } = createHarness();

  lifecycle.subscribe(agentA);
  lifecycle.subscribe(agentBackup);
  lifecycle.unsubscribe(agentA.trackSid);

  assert.deepEqual(attached, ['TR_A', 'TR_B']);
  assert.deepEqual(detached, ['TR_A']);

  lifecycle.close();
  assert.deepEqual(detached, ['TR_A', 'TR_B']);
});

test('disconnect matches the exact participant identity', () => {
  const { detached, lifecycle } = createHarness();

  lifecycle.subscribe(agentA);
  lifecycle.subscribe(agentBackup);
  lifecycle.disconnect('agent');

  assert.deepEqual(detached, ['TR_A']);

  lifecycle.close();
  assert.deepEqual(detached, ['TR_A', 'TR_B']);
});

test('unsubscribe, disconnect, and close detach each track exactly once', () => {
  const { detached, lifecycle } = createHarness();

  lifecycle.subscribe(agentA);
  lifecycle.subscribe(agentC);
  lifecycle.subscribe(agentBackup);

  lifecycle.unsubscribe(agentA.trackSid);
  lifecycle.unsubscribe(agentA.trackSid);
  lifecycle.disconnect('agent');
  lifecycle.disconnect('agent');
  lifecycle.close();
  lifecycle.close();

  assert.deepEqual(detached, ['TR_A', 'TR_C', 'TR_B']);
});

test('duplicate subscribe is idempotent by track SID', () => {
  const { attached, detached, lifecycle } = createHarness();

  lifecycle.subscribe(agentA);
  lifecycle.subscribe({ ...agentA, payload: { id: 'replacement-media-a' } });

  assert.deepEqual(attached, ['TR_A']);
  assert.deepEqual(detached, []);
});

test('close allows the same lifecycle to subscribe after a room reconnects', () => {
  const { attached, detached, lifecycle } = createHarness();

  lifecycle.subscribe(agentA);
  lifecycle.close();
  attached.length = 0;
  detached.length = 0;

  lifecycle.subscribe(agentA);

  assert.deepEqual(attached, ['TR_A']);
  assert.deepEqual(detached, []);

  lifecycle.close();
  assert.deepEqual(detached, ['TR_A']);
});

test('participant binding discovers participants populated during initial room connect', () => {
  const listeners = new Map();
  const participants = [];
  const attached = [];
  const detached = [];
  const disconnected = [];
  let roomDisconnects = 0;
  const emit = (event, value) => listeners.get(event)?.forEach((listener) => listener(value));

  const stop = bindRemoteParticipantLifecycle({
    listParticipants: () => participants,
    observeConnected: (listener) => observe('connected', listener),
    observeDisconnected: (listener) => observe('disconnected', listener),
    observeParticipantConnected: (listener) => observe('participantConnected', listener),
    observeParticipantDisconnected: (listener) => observe('participantDisconnected', listener),
    attachParticipant: (participant) => {
      attached.push(participant.identity);
      return () => detached.push(participant.identity);
    },
    onParticipantDisconnected: (participant) => disconnected.push(participant.identity),
    onRoomDisconnected: () => {
      roomDisconnects += 1;
    },
  });

  const agent = { identity: 'agent' };
  participants.push(agent);
  emit('connected');

  assert.deepEqual(attached, ['agent']);

  emit('disconnected');
  assert.deepEqual(detached, ['agent']);
  assert.equal(roomDisconnects, 1);

  emit('connected');
  assert.deepEqual(attached, ['agent', 'agent']);

  emit('participantDisconnected', agent);
  assert.deepEqual(detached, ['agent', 'agent']);
  assert.deepEqual(disconnected, ['agent']);

  stop();

  function observe(event, listener) {
    const eventListeners = listeners.get(event) ?? new Set();
    eventListeners.add(listener);
    listeners.set(event, eventListeners);
    return () => eventListeners.delete(listener);
  }
});

test('participant binding registers event listeners before its initial snapshot', () => {
  const participant = { identity: 'agent' };
  const attached = [];
  const listenerOrder = [];
  const listeners = new Map();

  const stop = bindRemoteParticipantLifecycle({
    listParticipants: () => {
      listenerOrder.push('snapshot');
      return [participant];
    },
    observeConnected: (listener) => observe('connected', listener),
    observeDisconnected: (listener) => observe('disconnected', listener),
    observeParticipantConnected: (listener) => observe('participantConnected', listener),
    observeParticipantDisconnected: (listener) => observe('participantDisconnected', listener),
    attachParticipant: (entry) => {
      attached.push(entry.identity);
      return () => undefined;
    },
    onParticipantDisconnected: () => undefined,
    onRoomDisconnected: () => undefined,
  });

  assert.deepEqual(listenerOrder, [
    'on:connected',
    'on:participantConnected',
    'on:participantDisconnected',
    'on:disconnected',
    'snapshot',
  ]);
  assert.deepEqual(attached, ['agent']);

  stop();

  function observe(event, listener) {
    listenerOrder.push(`on:${event}`);
    listeners.set(event, listener);
    return () => listeners.delete(event);
  }
});
