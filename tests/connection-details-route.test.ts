import test from 'node:test';
import assert from 'node:assert/strict';

import { readOptionalJsonBody } from '../lib/connection-details.ts';

test('readOptionalJsonBody returns undefined for an empty request body', async () => {
  const request = new Request('http://localhost/api/connection-details', {
    method: 'POST',
  });

  const body = await readOptionalJsonBody(request);

  assert.equal(body, undefined);
});

test('readOptionalJsonBody returns parsed JSON when request body is present', async () => {
  const request = new Request('http://localhost/api/connection-details', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      room_config: {
        agents: [{ agent_name: 'frontdesk-agent' }],
      },
    }),
  });

  const body = await readOptionalJsonBody(request);

  assert.deepEqual(body, {
    room_config: {
      agents: [{ agent_name: 'frontdesk-agent' }],
    },
  });
});
