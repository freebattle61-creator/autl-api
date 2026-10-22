import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const root = path.resolve('.');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuro-contract-'));
const file = path.join(dir, 'contract.sqlite');
const password = 'contract-test-password';
const hash = await bcrypt.hash(password, 4);
const key = (key_value: string, extra: Record<string, unknown> = {}) => ({
  id: key_value.length, key_value, product_id: 'kuro', duration_days: 7, max_devices: 2,
  hwid_list: [], is_disabled: 0, created_at: '2024-01-01T00:00:00.000Z', created_by: 'contract-admin', ...extra
});
const valid = (key_value: string, hwid: string, extra: Record<string, unknown> = {}) => key(key_value, {
  activated_at: '2026-01-01T00:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z', hwid_list: [hwid], ...extra
});
const session = (session_id: string, key_value: string, hwid: string, extra: Record<string, unknown> = {}) => ({
  session_id, key_value, hwid, created_at: '2026-01-01T00:00:00.000Z', last_heartbeat: '2026-01-01T00:00:00.000Z',
  expires_at: '2099-01-01T00:00:00.000Z', ...extra
});
const state = {
  admin: { username: 'contract-admin', password_hash: hash },
  resellers: [{ id: 19, username: 'contract-reseller', password_hash: hash, balance: 321.45, is_active: 1, created_at: '2024-01-01T00:00:00.000Z' }],
  prices: [{ product_id: 'kuro', duration_days: 1, price: 9.25 }, { product_id: 'kuro', duration_days: 7, price: 41.75 }],
  keys: [
    key('KURO-NO-PRODUCT'), key('KURO-REPEAT', { id: 4 }),
    key('AIM-LEGACY', { id: 2, product_id: 'aim-cheto' }), key('SAMURAI-LEGACY', { id: 3, product_id: 'samurai-engine' }),
    valid('KURO-HEARTBEAT-TARGET', 'target-device', { id: 10 }),
    valid('KURO-OTHER-SESSION', 'other-device', { id: 11 }),
    valid('KURO-EXPIRED-SESSION', 'expired-session-device', { id: 12 }),
    valid('KURO-REVOKED-SESSION', 'revoked-session-device', { id: 13 }),
    valid('KURO-DISABLED-HEARTBEAT', 'disabled-device', { id: 14, is_disabled: 1 }),
    valid('KURO-EXPIRED-LICENSE', 'expired-license-device', { id: 15, expires_at: '2024-01-02T00:00:00.000Z' }),
    valid('KURO-REVOKED-BINDING', 'old-device', { id: 16, hwid_list: ['different-device'] }),
    key('KURO-HASH-HWID', { id: 18 }),
    key('KURO-INVALID-ACTIVATION', { id: 17, hwid_list: ['invalid-device'] }),
    key('UNRELATED-KEY', { id: 99, product_id: 'aim-cheto', hwid_list: ['untouched-device'] })
  ],
  sessions: [
    session('target-session', 'KURO-HEARTBEAT-TARGET', 'target-device'),
    session('other-issued-session', 'KURO-OTHER-SESSION', 'other-device'),
    session('expired-session', 'KURO-EXPIRED-SESSION', 'expired-session-device', { expires_at: '2024-01-02T00:00:00.000Z' }),
    session('revoked-session', 'KURO-REVOKED-SESSION', 'revoked-session-device', { revoked: true }),
    session('disabled-session', 'KURO-DISABLED-HEARTBEAT', 'disabled-device'),
    session('expired-license-session', 'KURO-EXPIRED-LICENSE', 'expired-license-device'),
    session('binding-session', 'KURO-REVOKED-BINDING', 'old-device'),
    session('invalid-state-session', 'KURO-INVALID-ACTIVATION', 'invalid-device')
  ],
  balance_logs: [{ id: 1, reseller_id: 19, amount: -1, reason: 'fixture', created_at: '2024-01-01T00:00:00.000Z' }]
};
// The legacy fixture deliberately has no stored product field.
delete (state.keys.find(k => k.key_value === 'SAMURAI-LEGACY') as Record<string, unknown>).product_id;
const db = new DatabaseSync(file);
db.exec('CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, value TEXT NOT NULL)');
db.prepare('INSERT INTO state VALUES(1,7,?)').run(JSON.stringify(state));
db.close();

let child: ChildProcess | undefined;
let base = '';
async function stop() {
  if (!child || child.exitCode !== null) { child = undefined; return; }
  const done = new Promise<void>(resolve => child!.once('close', () => resolve()));
  child.kill('SIGTERM'); await done; child = undefined;
}
async function start() {
  const listener = net.createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), LICENSE_DB_FILE: file, SESSION_TTL_SECONDS: '3600' };
  child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout?.on('data', x => output += x); child.stderr?.on('data', x => output += x);
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) throw Error('Server exited: ' + output);
    try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Server not ready: ' + output);
}
async function call(route: string, body?: unknown) {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
function snapshot() { const handle = new DatabaseSync(file); const row = handle.prepare('SELECT revision,value FROM state WHERE id=1').get() as { revision: number, value: string }; handle.close(); return { revision: row.revision, value: JSON.parse(row.value) as typeof state }; }
const activatedKeys = new Set(['KURO-NO-PRODUCT', 'KURO-REPEAT', 'AIM-LEGACY', 'SAMURAI-LEGACY', 'KURO-HASH-HWID']);
function unrelated(value: typeof state) { return { admin: value.admin, resellers: value.resellers, prices: value.prices, balance_logs: value.balance_logs, untouched: value.keys.filter(k => !activatedKeys.has(k.key_value)) }; }
const activationFields = ['success', 'error_code', 'message', 'session_id', 'expires_at', 'expires', 'plan', 'product_id', 'product_name', 'session_expires_at', 'heartbeat_interval', 'user', 'seller'];
const heartbeatFields = ['success', 'error_code', 'message', 'session_id', 'expires_at', 'plan', 'session_expires_at', 'heartbeat_interval', 'user', 'seller'];
function exact(body: Record<string, any>, fields: string[]) { assert.deepEqual(Object.keys(body).sort(), [...fields].sort()); }
// Public contract checks intentionally do not depend on compatibility metadata.
function core(body: Record<string, any>, label: string) {
  assert.equal(body.success, true, label);
  assert.equal(typeof body.session_id, 'string', label); assert.ok(body.session_id.length > 0, label);
  assert.equal(body.heartbeat_interval, 60, label);
  assert.equal(typeof body.user?.expires_at, 'string', label);
  assert.equal(new Date(body.user.expires_at).toISOString(), body.user.expires_at, label);
}
function failure(result: { status: number, body: Record<string, any> }, status: number, code: number, message: string, before: ReturnType<typeof snapshot>, label: string, sessionId: string | null | undefined = undefined) {
  assert.equal(result.status, status, label); const expected = { success: false, error_code: code, message, ...(sessionId === undefined ? {} : { session_id: sessionId }) }; assert.deepEqual(result.body, expected, label); assert.deepEqual(snapshot(), before, label);
}

try {
  await start();
  const initial = snapshot();
  const kuro = await call('/api/activate', { license_key: 'KURO-NO-PRODUCT', hwid: 'kuro-device' });
  assert.equal(kuro.status, 200); assert.deepEqual(Object.keys(kuro.body).sort(), activationFields.sort());
  core(kuro.body, 'activation core contract without product_id'); assert.equal(kuro.body.session_id.length, 32);
  assert.equal(kuro.body.product_id, 'kuro'); assert.equal(kuro.body.product_name, 'KURO'); assert.equal(kuro.body.expires, kuro.body.expires_at); assert.equal(kuro.body.user.expires_at, kuro.body.expires_at);
  assert.equal(new Date(kuro.body.expires_at).toISOString(), kuro.body.expires_at); assert.equal(new Date(kuro.body.session_expires_at).toISOString(), kuro.body.session_expires_at);
  const project = (body: Record<string, any>) => ({ success: body.success, session_id: body.session_id, heartbeat_interval: body.heartbeat_interval, user: { expires_at: body.user.expires_at } });
  const projectedCore = project(kuro.body);
  core(projectedCore, 'stable activation consumer ignores compatibility fields');
  assert.equal(kuro.body.error_code, 0, 'existing activation compatibility code');
  assert.deepEqual(unrelated(snapshot().value), unrelated(initial.value));

  const repeat1 = await call('/api/activate', { license_key: 'KURO-REPEAT', hwid: 'repeat-device', product_id: 'kuro' });
  const repeat2 = await call('/api/activate', { license_key: 'KURO-REPEAT', hwid: 'repeat-device', product_id: 'kuro' });
  for (const result of [repeat1, repeat2]) { assert.equal(result.status, 200); exact(result.body, activationFields); core(result.body, 'activation core contract with product_id'); assert.equal(result.body.product_id, 'kuro'); assert.equal(result.body.expires, result.body.expires_at); assert.equal(new Date(result.body.expires_at).toISOString(), result.body.expires_at); }
  assert.notEqual(repeat1.body.session_id, repeat2.body.session_id); assert.equal(repeat1.body.expires_at, repeat2.body.expires_at);
  const aim = await call('/api/activate', { license_key: 'AIM-LEGACY', hwid: 'aim-device' });
  const samurai = await call('/api/activate', { license_key: 'SAMURAI-LEGACY', hwid: 'samurai-device' });
  assert.equal(aim.body.product_id, 'aim-cheto'); assert.equal(samurai.body.product_id, 'samurai-engine');

  const mismatchBefore = snapshot();
  failure(await call('/api/activate', { license_key: 'KURO-NO-PRODUCT', hwid: 'x', product_id: 'aim-cheto' }), 400, 1001, 'Product does not match license key', mismatchBefore, 'activation product mismatch', null);
  const unknownBefore = snapshot();
  failure(await call('/api/activate', { license_key: 'KURO-NO-PRODUCT', hwid: 'x', product_id: 'not-a-product' }), 400, 1001, 'Unknown product_id', unknownBefore, 'unknown activation product');

  const heartbeat = await call('/api/heartbeat', { license_key: 'KURO-HEARTBEAT-TARGET', session_id: 'target-session', hwid: 'target-device' });
  assert.equal(heartbeat.status, 200); exact(heartbeat.body, heartbeatFields); core(heartbeat.body, 'heartbeat core contract'); assert.deepEqual(heartbeat.body, { success: true, error_code: 0, message: 'Heartbeat OK', session_id: 'target-session', expires_at: '2099-01-01T00:00:00.000Z', plan: '7 Days', session_expires_at: '2099-01-01T00:00:00.000Z', heartbeat_interval: 60, user: { expires_at: '2099-01-01T00:00:00.000Z' }, seller: { name: 'Shadow Cracker' } });
  const hashLikeHwid = 'a4f6c2d8e1b9470fa8c31d5e6b7290c4f1a8e3d7b2c6950f8e4d1a7c3b9e6f20';
  const hashActivation = await call('/api/activate', { license_key: 'KURO-HASH-HWID', hwid: hashLikeHwid });
  assert.equal(hashActivation.status, 200); exact(hashActivation.body, activationFields); core(hashActivation.body, 'hash-like HWID activation without product_id');
  const hashHeartbeat = await call('/api/heartbeat', { license_key: 'KURO-HASH-HWID', session_id: hashActivation.body.session_id, hwid: hashLikeHwid });
  assert.equal(hashHeartbeat.status, 200); exact(hashHeartbeat.body, heartbeatFields); core(hashHeartbeat.body, 'hash-like HWID heartbeat');
  core(project(hashHeartbeat.body), 'stable heartbeat consumer ignores compatibility fields');
  assert.equal(hashHeartbeat.body.session_id, hashActivation.body.session_id);
  assert.equal(hashHeartbeat.body.user.expires_at, hashActivation.body.user.expires_at);
  // This opaque synthetic value does not specify or replace the Android hash algorithm.
  assert.deepEqual(snapshot().value.keys.find(k => k.key_value === 'KURO-HASH-HWID')!.hwid_list, [hashLikeHwid]);
  await stop(); await start();
  const issuedHeartbeat = await call('/api/heartbeat', { license_key: 'KURO-NO-PRODUCT', session_id: kuro.body.session_id, hwid: 'kuro-device' });
  assert.equal(issuedHeartbeat.status, 200); exact(issuedHeartbeat.body, heartbeatFields);
  assert.equal(issuedHeartbeat.body.success, true); assert.equal(issuedHeartbeat.body.session_id, kuro.body.session_id);
  assert.equal(issuedHeartbeat.body.expires_at, kuro.body.expires_at); assert.equal(issuedHeartbeat.body.session_expires_at, kuro.body.session_expires_at);
  const persistedHashHeartbeat = await call('/api/heartbeat', { license_key: 'KURO-HASH-HWID', session_id: hashActivation.body.session_id, hwid: hashLikeHwid });
  assert.equal(persistedHashHeartbeat.status, 200); exact(persistedHashHeartbeat.body, heartbeatFields); core(persistedHashHeartbeat.body, 'hash-like HWID session persists after restart');
  assert.equal(persistedHashHeartbeat.body.session_id, hashActivation.body.session_id);
  assert.equal(persistedHashHeartbeat.body.user.expires_at, hashActivation.body.user.expires_at);
  const wrongHashBefore = snapshot();
  failure(await call('/api/heartbeat', { license_key: 'KURO-HASH-HWID', session_id: hashActivation.body.session_id, hwid: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }), 403, 2005, 'HWID mismatch on heartbeat', wrongHashBefore, 'wrong hash-like HWID is rejected without mutation');
  const afterRestart = await call('/api/heartbeat', { license_key: 'KURO-HEARTBEAT-TARGET', session_id: 'target-session', hwid: 'target-device' });
  assert.equal(afterRestart.status, 200); assert.equal(afterRestart.body.success, true); assert.equal(afterRestart.body.session_id, 'target-session'); assert.equal(afterRestart.body.session_expires_at, heartbeat.body.session_expires_at); assert.equal(afterRestart.body.expires_at, heartbeat.body.expires_at); assert.equal(afterRestart.body.heartbeat_interval, 60);

  const failures: Array<[string, Record<string, unknown>, number, number, string]> = [
    ['wrong key', { license_key: 'KURO-HEARTBEAT-TARGET', session_id: kuro.body.session_id, hwid: 'kuro-device' }, 401, 2002, 'Invalid, revoked, or expired session ID'],
    ['HWID mismatch', { license_key: 'KURO-HEARTBEAT-TARGET', session_id: 'target-session', hwid: 'wrong-device' }, 403, 2005, 'HWID mismatch on heartbeat'],
    ['fabricated session', { license_key: 'KURO-HEARTBEAT-TARGET', session_id: crypto.randomBytes(16).toString('hex'), hwid: 'target-device' }, 401, 2002, 'Invalid, revoked, or expired session ID'],
    ['expired session', { license_key: 'KURO-EXPIRED-SESSION', session_id: 'expired-session', hwid: 'expired-session-device' }, 401, 2006, 'Session has expired'],
    ['revoked session', { license_key: 'KURO-REVOKED-SESSION', session_id: 'revoked-session', hwid: 'revoked-session-device' }, 401, 2002, 'Invalid, revoked, or expired session ID'],
    ['disabled license heartbeat', { license_key: 'KURO-DISABLED-HEARTBEAT', session_id: 'disabled-session', hwid: 'disabled-device' }, 403, 2003, 'License key is invalid or disabled'],
    ['expired license heartbeat', { license_key: 'KURO-EXPIRED-LICENSE', session_id: 'expired-license-session', hwid: 'expired-license-device' }, 400, 2004, 'License has expired'],
    ['revoked binding', { license_key: 'KURO-REVOKED-BINDING', session_id: 'binding-session', hwid: 'old-device' }, 403, 2007, 'Device binding revoked or reset'],
    ['invalid activation state', { license_key: 'KURO-INVALID-ACTIVATION', session_id: 'invalid-state-session', hwid: 'invalid-device' }, 403, 2003, 'License activation state is invalid'],
    ['missing params', { license_key: 'KURO-HEARTBEAT-TARGET' }, 400, 1001, 'device_fingerprint is required']
  ];
  for (const [label, request, status, code, message] of failures) {
    const before = snapshot();
    failure(await call('/api/heartbeat', request), status, code, message, before, label);
  }
  assert.deepEqual(unrelated(snapshot().value), unrelated(initial.value));
  console.log('KURO contract integration passed: explicit product fixtures, exact activation/repeat/restart behavior, all heartbeat failure branches, failure immutability, and unrelated-state preservation.');
} finally { await stop(); fs.rmSync(dir, { recursive: true, force: true }); }
