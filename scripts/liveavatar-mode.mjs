export function resolveLiveAvatarMode(env = process.env) {
  const sandboxSwitch = readBooleanSwitch(env.LIVEAVATAR_USE_SANDBOX);
  return sandboxSwitch ? 'sandbox-gateway' : 'app';
}

function readBooleanSwitch(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}
