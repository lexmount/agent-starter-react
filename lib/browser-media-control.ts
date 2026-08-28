export const MEDIA_CONTROL_TOPIC = 'lk.media.control';
export const MEDIA_STATE_TOPIC = 'lk.media.state';

export interface BrowserMediaControlCommand {
  schema_version: 1;
  type: 'lk.media.control';
  command_id: string;
  policy_epoch: string;
  sequence: number;
  target_identity: string;
  desired_listening: 'open' | 'closed';
  issued_at_unix_ms: number;
  expires_at_unix_ms: number;
  reason?: string;
}

export class BrowserMediaControlTracker {
  private activeEpoch: string | null = null;
  private sequence = 0;
  private readonly retiredEpochs = new Set<string>();

  accept(command: BrowserMediaControlCommand) {
    if (command.policy_epoch === this.activeEpoch) {
      if (command.sequence <= this.sequence) return false;
    } else {
      if (this.retiredEpochs.has(command.policy_epoch)) return false;
      if (this.activeEpoch) this.retiredEpochs.add(this.activeEpoch);
      this.activeEpoch = command.policy_epoch;
    }
    this.sequence = command.sequence;
    return true;
  }
}

export function parseBrowserMediaControl(
  payload: Uint8Array,
  targetIdentity: string,
  nowUnixMs = Date.now()
): BrowserMediaControlCommand | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const command = value as Record<string, unknown>;
  if (
    command.schema_version !== 1 ||
    command.type !== 'lk.media.control' ||
    typeof command.command_id !== 'string' ||
    !command.command_id ||
    typeof command.policy_epoch !== 'string' ||
    !command.policy_epoch ||
    !Number.isSafeInteger(command.sequence) ||
    (command.sequence as number) <= 0 ||
    command.target_identity !== targetIdentity ||
    !['open', 'closed'].includes(String(command.desired_listening)) ||
    !Number.isSafeInteger(command.issued_at_unix_ms) ||
    !Number.isSafeInteger(command.expires_at_unix_ms) ||
    (command.expires_at_unix_ms as number) <= (command.issued_at_unix_ms as number)
  ) {
    return null;
  }
  if ((command.expires_at_unix_ms as number) <= nowUnixMs) return null;
  return command as unknown as BrowserMediaControlCommand;
}
