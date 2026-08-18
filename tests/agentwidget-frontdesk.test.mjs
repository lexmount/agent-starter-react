import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

const readSource = (path) => readFile(new URL(path, root), 'utf8');

test('AI frontdesk composes AgentWidget over the existing LiveKit room', async () => {
  const [controller, frontdesk] = await Promise.all([
    readSource('components/app/view-controller.tsx'),
    readSource('components/agentwidget/ai-frontdesk.jsx'),
  ]);

  assert.match(controller, /<AiFrontdesk/);
  assert.doesNotMatch(controller, /<WelcomeView|<SessionView/);
  assert.match(frontdesk, /const room = useRoomContext\(\)/);
  assert.match(frontdesk, /createLexVoiceAdapter\(\{ client: adapterClient \}\)/);
  assert.doesNotMatch(frontdesk, /new Room\(/);
  assert.match(frontdesk, /createAgentWidgetSurfaceChannelClient\(\)/);
  assert.match(frontdesk, /canvas\.surfaceIds\.length > 0 \? 'active' : 'intro'/);
  assert.match(frontdesk, /!isSessionActive && canvas\.surfaceIds\.length === 0/);
});

test('AgentWidget host route publishes canonical SDK output to an isolated channel', async () => {
  const [spawnRoute, surfaceRoute] = await Promise.all([
    readSource('app/api/agentwidget/spawn/route.js'),
    readSource('app/api/agentwidget/surfaces/route.js'),
  ]);

  assert.match(spawnRoute, /@lexmount\/agentwidget-sdk\/host/);
  assert.match(spawnRoute, /createSpawnWidgetResult\(input/);
  assert.match(spawnRoute, /x-agentwidget-channel-id/);
  assert.match(spawnRoute, /\.publish\(/);
  assert.match(surfaceRoute, /text\/event-stream/);
  assert.match(surfaceRoute, /searchParams\.get\('channel'\)/);
});

test('surface channel isolates sessions and replays only each channel latest surface', async () => {
  const { getAgentWidgetSurfaceChannel } = await import(
    `../lib/agentwidget/surface-channel.js?test=${Date.now()}`
  );
  const hub = getAgentWidgetSurfaceChannel();
  const firstChannel = 'agentwidget-test-channel-a';
  const secondChannel = 'agentwidget-test-channel-b';
  const firstSurface = { protocol: 'agentwidget/1.0', surface: { id: 'a' } };
  const secondSurface = { protocol: 'agentwidget/1.0', surface: { id: 'b' } };
  const firstEvents = [];
  const secondEvents = [];

  hub.publish(firstChannel, firstSurface);
  const unsubscribeFirst = hub.subscribe(firstChannel, (event) => firstEvents.push(event));
  const unsubscribeSecond = hub.subscribe(secondChannel, (event) => secondEvents.push(event));
  hub.publish(secondChannel, secondSurface);

  assert.deepEqual(firstEvents, [firstSurface]);
  assert.deepEqual(secondEvents, [secondSurface]);
  unsubscribeFirst();
  unsubscribeSecond();
});

test('AgentWidget dependency is pinned to the reviewed UI library commit', async () => {
  const manifest = JSON.parse(await readSource('package.json'));
  assert.equal(
    manifest.dependencies['@lexmount/agentwidget-sdk'],
    'git+https://github.com/lexmount/agent-uilib.git#996976ea8c4a2de515943a6d5138e385c6f6cd50'
  );
});
