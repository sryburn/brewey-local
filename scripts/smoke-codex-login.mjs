#!/usr/bin/env node
// Exercise native Codex HTTPS, then cancel. Never print codes or use saved credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const home = await mkdtemp(join(tmpdir(), 'brewey-login-smoke-'));
const userHome = join(home, 'user');
await mkdir(userHome, { mode: 0o700 });
const env = { PATH: process.env.PATH, HOME: userHome, CODEX_HOME: home, LANG: 'C.UTF-8' };
for (const key of ['SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS']) if (process.env[key]) env[key] = process.env[key];
const child = spawn('codex', ['app-server', '--listen', 'stdio://', '-c', 'forced_login_method="chatgpt"', '-c', 'cli_auth_credentials_store="file"'], { env, cwd: home, stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.resume();
const pending = new Map();
let id = 0;
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const entry = pending.get(message.id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});
function failed(error) {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
  pending.clear();
}
child.on('error', failed);
child.on('exit', () => failed(new Error('Codex exited before completing the request.')));
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out.`)); }, 30000);
    pending.set(requestId, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n');
  });
}
try {
  await rpc('initialize', { clientInfo: { name: 'brewey_login_smoke', version: '1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const account = await rpc('account/read', { refreshToken: false });
  assert.equal(account.account, null, 'Smoke home must have no saved account.');
  const login = await rpc('account/login/start', { type: 'chatgptDeviceCode' });
  assert.equal(login.type, 'chatgptDeviceCode');
  assert(login.loginId && login.userCode && new URL(login.verificationUrl).protocol === 'https:');
  await rpc('account/login/cancel', { loginId: login.loginId });
  console.log('PASS: native Codex requested a device code over trusted HTTPS, then cancelled; no saved account or inference used.');
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  child.kill();
  await new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  lines.close();
  await rm(home, { recursive: true, force: true });
}
