import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as chatSend from '../lib/chat-send.ts';

const { ChatSendTimeoutError, sendChatMessageWithTimeout } = chatSend;

test('sendChatMessageWithTimeout returns after a successful send', async () => {
  let received = '';

  await sendChatMessageWithTimeout(
    async (message) => {
      received = message;
    },
    'hello',
    25
  );

  assert.equal(received, 'hello');
});

test('sendChatMessageWithTimeout surfaces an underlying send rejection', async () => {
  await assert.rejects(
    sendChatMessageWithTimeout(
      async () => {
        throw new Error('data transport unavailable');
      },
      'hello',
      25
    ),
    /data transport unavailable/
  );
});

test(
  'sendChatMessageWithTimeout rejects a stalled send within the configured bound',
  { timeout: 100 },
  async () => {
    await assert.rejects(
      sendChatMessageWithTimeout(() => new Promise(() => {}), 'hello', 10),
      ChatSendTimeoutError
    );
  }
);

test('ChatInput reports send failures visibly and retains the message for retry', async () => {
  const source = await readFile('components/livekit/agent-control-bar/chat-input.tsx', 'utf8');

  assert.match(source, /sendChatMessageWithTimeout\(onSend, message\)/);
  assert.match(source, /toastAlert\(/);
  assert.match(source, /Message could not be sent/);
  assert.ok(source.indexOf("setMessage('')") < source.indexOf('catch (error)'));
});
