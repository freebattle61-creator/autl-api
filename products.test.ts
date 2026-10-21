import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const root = path.resolve('.');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'products-'));
const file = path.join(dir, 'legacy.sqlite');
const adminPassword = crypto.randomBytes(16).toString('hex');
const resellerPassword = crypto.randomBytes(16).toString('hex');
const state = {
  admin: { username: 'catalog-admin', password_hash: await bcrypt.hash(adminPassword, 4) },
  resellers: [{ id: 7, username: 'legacy-reseller', password_hash: await bcrypt.hash(resellerPassword, 4), balance: 100, is_active: 1, created_at: '2020-01-01T00:00:00Z' }],
  prices: [{ duration_days: 1, price: 9 }, { duration_days: 3, price: 20 }],
  keys: [{ id: 41, key_value: 'SH-LEGACY-KEY', duration_days: 1, max_devices: 1, hwid_list: [], is_disabled: 0, created_at: '2020-01-01T00:00:00Z', created_by: 'catalog-admin' }],
  sessions: [], balance_logs: []
};
const db = new DatabaseSync(file);
db.exec('CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,value TEXT NOT NULL)');
db.prepare('INSERT INTO state VALUES(1,0,?)').run(JSON.stringify(state));
db.close();
let child: ChildProcess | undefined;
let base = '';
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done = new Promise<void>(resolve => child!.once('close', () => resolve()));
  child.kill('SIGTERM'); await done; child = undefined;
}
async function start() {
  const listener = net.createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), LICENSE_DB_FILE: file };
  for (const key of Object.keys(env)) if (key.startsWith('FIREBASE_') || key === 'GOOGLE_APPLICATION_CREDENTIALS') delete env[key];
  child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', x => output += x); child.stderr?.on('data', x => output += x);
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) throw Error(output);
    try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Server not ready: ' + output);
}
async function call(route: string, body?: any, token?: string, raw?: string) {
  const response = await fetch(base + route, {
    method: body === undefined && raw === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body))
  });
  return { status: response.status, body: await response.json() as any };
}
function good(result: Awaited<ReturnType<typeof call>>) { assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.success, true); }
function bad(result: Awaited<ReturnType<typeof call>>, status = 400) { assert.equal(result.status, status, JSON.stringify(result.body)); assert.equal(result.body.success, false); }
async function login(username: string, password: string) { const result = await call('/api/auth/login', { username, password }); good(result); return result.body.token as string; }
try {
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  await start();
  let admin = await login('catalog-admin', adminPassword);
  const data = (await call('/api/admin/data', undefined, admin)).body;
  assert.deepEqual(data.products.map((p: any) => p.id), ['samurai-engine', 'aim-cheto']);
  assert.equal(data.products[1].name, 'AIM CHETO');
  assert.equal(data.keys[0].product_id, 'samurai-engine');
  assert.equal(data.keys[0].price_at_issue, null);
  assert.equal(data.keys[0].issuer_role, 'admin');
  assert.equal(data.keys[0].issuer_username, 'catalog-admin');
  assert.equal(data.prices.find((p: any) => p.product_id === 'samurai-engine' && p.duration_days === 1).price, 9);
  assert.ok(!data.prices.some((p: any) => p.product_id === 'aim-cheto'));
  bad(await call('/api/admin/prices', undefined, admin, '{'));
  bad(await call('/api/admin/prices', { product_id: 'bogus', prices: { '1': 2 } }, admin));
  for (const prices of [{ '0': 2 }, { '1.5': 2 }, { '-1': 2 }, { '1': -1 }, { '1': 1.236 }, { '1': null }, { '1': '10' }, { '1': 1e20 }]) {
    bad(await call('/api/admin/prices', { product_id: 'samurai-engine', prices }, admin));
  }
  bad(await call('/api/admin/generate', { product_id: 'aim-cheto', duration: 1, count: 1 }, admin));
  good(await call('/api/admin/prices', { product_id: 'samurai-engine', prices: { '1': 10, '3': 21 } }, admin));
  // Common decimal amounts must not fail because of binary floating-point representation.
  good(await call('/api/admin/prices', { product_id: 'aim-cheto', prices: { '1': 30, '3': 80, '7': 1.1, '8': 1.15, '9': 2.55, '14': 19.99, '15': 0.29, '2': 0 } }, admin));
  good(await call('/api/admin/reseller/create', { username: 'new-reseller', password: resellerPassword, balance: 100 }, admin));
  const reseller = await login('new-reseller', resellerPassword);
  bad(await call('/api/admin/prices', { product_id: 'aim-cheto', prices: { '1': 30 } }, reseller), 403);
  good(await call('/api/admin/generate', { duration: 1, count: 1 }, admin));
  good(await call('/api/admin/generate', { product_id: 'aim-cheto', duration: 1, count: 1 }, admin));
  good(await call('/api/reseller/generate', { product_id: 'aim-cheto', duration: 1, count: 2 }, reseller));
  let resellerData = (await call('/api/reseller/data', undefined, reseller)).body;
  assert.equal(resellerData.reseller.balance, 40);
  assert.ok(resellerData.keys.every((k: any) => k.product_id === 'aim-cheto' && k.price_at_issue === 30 && k.issuer_role === 'reseller' && k.issuer_username === 'new-reseller'));
  const key = resellerData.keys[0];
  bad(await call('/api/activate', { license_key: key.key_value, hwid: 'device-a', product_id: 'samurai-engine' }));
  const activation = await call('/api/activate', { license_key: key.key_value, hwid: 'device-a' }); good(activation);
  assert.equal(activation.body.product_id, 'aim-cheto'); assert.equal(activation.body.product_name, 'AIM CHETO');
  assert.ok(activation.body.session_id); assert.ok(activation.body.expires_at); assert.ok(activation.body.session_expires_at);
  good(await call('/api/heartbeat', { license_key: key.key_value, session_id: activation.body.session_id, hwid: 'device-a' }));
  bad(await call('/api/heartbeat', { license_key: key.key_value, session_id: activation.body.session_id, hwid: 'other-device' }), 403);
  good(await call('/api/admin/prices', { product_id: 'aim-cheto', prices: { '1': 99 } }, admin));
  bad(await call('/api/reseller/generate', { product_id: 'aim-cheto', duration: 1, count: 1 }, reseller));
  for (const request of [{ product_id: 'bogus', duration: 1 }, { product_id: 'aim-cheto', duration: 0 }, { product_id: 'aim-cheto', duration: 1.5 }, { product_id: 'aim-cheto', duration: -1 }, { product_id: 'aim-cheto', duration: 999 }]) bad(await call('/api/reseller/generate', request, reseller));
  good(await call('/api/reseller/generate', { product_id: 'aim-cheto', duration: 2, count: 2 }, reseller));
  assert.equal((await call('/api/reseller/data', undefined, reseller)).body.reseller.balance, 40);
  good(await call('/api/reseller/generate', { product_id: 'aim-cheto', duration: 7, count: 3 }, reseller));
  assert.equal((await call('/api/reseller/data', undefined, reseller)).body.reseller.balance, 36.7);
  good(await call('/api/reseller/generate', { product_id: 'samurai-engine', duration: 1, count: 1 }, reseller));
  resellerData = (await call('/api/reseller/data', undefined, reseller)).body;
  assert.equal(resellerData.reseller.balance, 26.7);
  assert.equal(resellerData.keys.find((k: any) => k.key_value === key.key_value).price_at_issue, 30);
  const beforeRestart = (await call('/api/admin/data', undefined, admin)).body;
  assert.ok(beforeRestart.keys.some((k: any) => k.product_id === 'aim-cheto' && k.issuer_role === 'admin' && k.issuer_username === 'catalog-admin'));
  good(await call('/api/admin/reseller/toggle/' + resellerData.reseller.id, {}, admin));
  bad(await call('/api/reseller/data', undefined, reseller), 403);
  good(await call('/api/admin/reseller/toggle/' + resellerData.reseller.id, {}, admin));
  await stop(); await start(); admin = await login('catalog-admin', adminPassword);
  const afterRestart = (await call('/api/admin/data', undefined, admin)).body;
  assert.deepEqual(afterRestart.keys, beforeRestart.keys);
  assert.deepEqual(afterRestart.prices, beforeRestart.prices);
  assert.ok(afterRestart.resellers.some((r: any) => r.id === 7 && r.username === 'legacy-reseller' && r.balance === 100));
  const inspection = new DatabaseSync(file);
  const persisted = JSON.parse((inspection.prepare('SELECT value FROM state').get() as any).value); inspection.close();
  assert.deepEqual(persisted.admin, state.admin);
  assert.deepEqual(persisted.keys.find((k: any) => k.key_value === 'SH-LEGACY-KEY'), state.keys[0]);
  assert.deepEqual(persisted.resellers.find((r: any) => r.id === 7), state.resellers[0]);
  console.log('Product integration passed: legacy preservation, isolated pricing, decimals/zero price, authorization, issuance history, exact balances, activation/heartbeat, restart.');
} finally { await stop(); fs.rmSync(dir, { recursive: true, force: true }); }
