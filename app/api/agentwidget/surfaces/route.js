import {
  getAgentWidgetSurfaceChannel,
  parseAgentWidgetChannelId,
} from '@/lib/agentwidget/surface-channel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

export function GET(request) {
  let channelId;
  try {
    channelId = parseAgentWidgetChannelId(new URL(request.url).searchParams.get('channel'));
  } catch {
    return Response.json({ error: 'INVALID_CHANNEL' }, { status: 400 });
  }

  let close = () => undefined;
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (value) => {
        if (!closed) controller.enqueue(encoder.encode(value));
      };
      send('retry: 1000\n\n');
      const unsubscribe = getAgentWidgetSurfaceChannel().subscribe(channelId, (envelope) => {
        send(`event: surface\ndata: ${JSON.stringify(envelope)}\n\n`);
      });
      const heartbeat = setInterval(() => send(': keep-alive\n\n'), 15_000);
      close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      };
      request.signal.addEventListener('abort', close, { once: true });
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
    },
  });
}
