const CHANNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const GLOBAL_KEY = Symbol.for('lexmount.agentwidget.surface-channel');

export function parseAgentWidgetChannelId(value) {
  if (typeof value !== 'string' || !CHANNEL_PATTERN.test(value)) {
    throw new TypeError('Invalid AgentWidget channel id');
  }
  return value;
}

function createHub() {
  const channels = new Map();

  const entryFor = (channelId) => {
    let entry = channels.get(channelId);
    if (!entry) {
      entry = { latest: null, listeners: new Set() };
      channels.set(channelId, entry);
    }
    return entry;
  };

  return {
    publish(channelId, envelope) {
      const entry = entryFor(parseAgentWidgetChannelId(channelId));
      entry.latest = envelope;
      for (const listener of entry.listeners) listener(envelope);
    },

    subscribe(channelId, listener) {
      const resolved = parseAgentWidgetChannelId(channelId);
      const entry = entryFor(resolved);
      entry.listeners.add(listener);
      if (entry.latest) listener(entry.latest);
      return () => {
        entry.listeners.delete(listener);
        if (!entry.latest && entry.listeners.size === 0) channels.delete(resolved);
      };
    },
  };
}

export function getAgentWidgetSurfaceChannel() {
  globalThis[GLOBAL_KEY] ??= createHub();
  return globalThis[GLOBAL_KEY];
}
