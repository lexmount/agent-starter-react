import { spawn } from 'node:child_process';
import { resolveLiveAvatarMode } from './liveavatar-mode.mjs';

const mode = resolveLiveAvatarMode(process.env);

if (mode === 'sandbox-gateway') {
  const { startSandboxGateway } = await import('../server/sandbox-gateway/server.mjs');
  startSandboxGateway();
} else {
  const child = spawn('next', ['start'], {
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}
