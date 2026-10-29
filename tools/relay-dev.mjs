// Starts the relay locally with `wrangler dev --local` for the co-op tests (127.0.0.1 only, throwaway state).
//   const base = await startRelay()  -> 'ws://127.0.0.1:<port>', or MB_RELAY when that is set
//   stopRelay()
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let child = null, tmpState = null;

export async function startRelay() {
  if (process.env.MB_RELAY) return process.env.MB_RELAY.replace(/\/+$/, '');
  const bins = [path.join(ROOT, 'node_modules/.bin/wrangler'), '/usr/local/bin/wrangler', path.resolve(ROOT, '../tree/node_modules/.bin/wrangler')];
  const bin = bins.find(b => fs.existsSync(b));
  if (!bin) throw new Error('wrangler not found; set MB_RELAY to a running relay');
  const port = 8800 + Math.floor(Math.random() * 400);
  tmpState = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-relay-'));
  child = spawn(bin, ['dev', '--port', String(port), '--ip', '127.0.0.1', '--local', '--persist-to', tmpState], {
    cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, detached: true,
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const t0 = Date.now();
  while (!/Ready on/.test(log)) {
    if (Date.now() - t0 > 90000 || child.exitCode !== null) throw new Error('wrangler dev did not start\n' + log.slice(-1200));
    await new Promise(r => setTimeout(r, 50));
  }
  return 'ws://127.0.0.1:' + port;
}

export function stopRelay() {
  if (child) { try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { /* gone */ } child = null; }
  if (tmpState) { try { fs.rmSync(tmpState, { recursive: true, force: true }); } catch (e) { /* ignore */ } tmpState = null; }
}
