// Opt-in: writes ONLY to a unique temporary child and deletes it when finished.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import dotenv from 'dotenv';
import { cert, initializeApp, deleteApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const env = { ...dotenv.parse(fs.readFileSync('.env')), ...process.env };
if (!env.FIREBASE_DATABASE_URL || !env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Local .env needs RTDB URL and a service-account file for this opt-in test.');
const adminPassword = crypto.randomBytes(32).toString('hex');
const app = initializeApp({ credential: cert(JSON.parse(fs.readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'))), databaseURL: env.FIREBASE_DATABASE_URL }, 'integration-test');
const db = getDatabase(app);
const testPath = '/license_api_startup_test_' + crypto.randomBytes(10).toString('hex');
const before = (await db.ref('/').get()).val() || {};
const digest = (value: any) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const originalDigest = digest(before);
let child: ChildProcess | undefined;
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done = new Promise<void>(resolve => child!.once('close', () => resolve()));
  child.kill('SIGTERM');
  await done;
  child = undefined;
}
async function freePort() {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
try {
  for (let run = 1; run <= 3; run++) {
    const port = await freePort();
    const base = 'http://127.0.0.1:' + port;
    let output = '';
    child = spawn(process.execPath, ['server.js'], { env: { ...env, NODE_ENV: 'production', PORT: String(port), FIREBASE_DATABASE_PATH: testPath, ADMIN_USERNAME: 'startup_test_admin', ADMIN_PASSWORD: adminPassword }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', d => { output += d; });
    child.stderr?.on('data', d => { output += d; });
    let ready = false;
    for (let attempt = 0; attempt < 240; attempt++) {
      if (child.exitCode !== null) throw new Error('Production child exited: ' + output);
      try {
        const health = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) });
        if (health.ok) { const body: any = await health.json(); assert.equal(body.storage, 'firebase'); ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(ready, true, 'Production must become ready');
    assert.doesNotMatch(output, /FATAL|Startup failed/);
    const login: any = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'startup_test_admin', password: adminPassword }) }).then(r => r.json());
    assert.equal(login.success, true, 'Real admin login must succeed');
    const headers = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
    if (run === 1) {
      const saved: any = await fetch(base + '/api/admin/generate', { method: 'POST', headers, body: JSON.stringify({ duration: 1, count: 1, max_devices: 1, note: 'temporary production-startup test' }) }).then(r => r.json());
      assert.equal(saved.success, true);
    }
    const data: any = await fetch(base + '/api/admin/data', { headers }).then(r => r.json());
    assert.equal(data.keys.length, 1, 'Key must persist across process restarts');
    assert.equal(data.resellers.length, 0, 'Demo reseller must not appear in production');
    await stop();
    console.log(`Real Firebase production startup ${run}/3 passed: health, login, persisted key.`);
  }
} finally {
  await stop();
  await db.ref(testPath).remove();
  const after = (await db.ref('/').get()).val() || {};
  assert.equal(digest(after), originalDigest, 'Existing Firebase data must remain unchanged');
  await deleteApp(app);
}
console.log('PASS: temporary test namespace removed; all pre-existing Firebase data is unchanged.');
