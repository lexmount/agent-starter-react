import { timingSafeEqual } from 'node:crypto';
import {
  AgentWidgetComposerError,
  createOpenAICompatibleWidgetComposerFromEnv,
  createSpawnWidgetResult,
} from '@lexmount/agentwidget-sdk/host';
import {
  getAgentWidgetSurfaceChannel,
  parseAgentWidgetChannelId,
} from '@/lib/agentwidget/surface-channel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHANNEL_HEADER = 'x-agentwidget-channel-id';
const MAX_BODY_BYTES = 16 * 1024;
let composer;

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function hasValidBearer(request, expectedToken) {
  if (!expectedToken) return true;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const expected = Buffer.from(expectedToken);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request) {
  const channelHeader = request.headers.get(CHANNEL_HEADER);
  const token = process.env.AGENTWIDGET_HOST_TOKEN;
  if (channelHeader && !token) return json({ error: 'HOST_TOKEN_NOT_CONFIGURED' }, 503);
  if (!hasValidBearer(request, token)) return json({ error: 'UNAUTHORIZED' }, 401);

  try {
    if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') {
      return json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, 415);
    }
    const text = await request.text();
    if (!text || Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
      return json({ error: 'INVALID_REQUEST' }, 400);
    }
    const input = JSON.parse(text);
    const result = await createSpawnWidgetResult(input, {
      getComposer: () => {
        composer ??= createOpenAICompatibleWidgetComposerFromEnv(process.env);
        return composer;
      },
    });
    if (channelHeader) {
      getAgentWidgetSurfaceChannel().publish(
        parseAgentWidgetChannelId(channelHeader),
        result.structuredContent
      );
    }
    return json({ structuredContent: result.structuredContent });
  } catch (error) {
    if (error instanceof AgentWidgetComposerError) {
      return json({ error: error.code }, error.code === 'MODEL_NOT_CONFIGURED' ? 503 : 502);
    }
    if (error instanceof SyntaxError || error instanceof TypeError || error?.name === 'ZodError') {
      return json({ error: 'INVALID_REQUEST' }, 400);
    }
    console.error('[agentwidget] spawn failed', error);
    return json({ error: 'COMPOSER_FAILED' }, 500);
  }
}
