import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { deleteApp, getApps } from 'firebase-admin/app';
import { firebaseOperation, initializeFirebaseStore } from './firebase-store';

let attempts = 0;
await assert.rejects(firebaseOperation(async () => { attempts++; throw new Error('ambiguous write'); }, 'CAS transaction'), /Firebase CAS transaction failed/);
assert.equal(attempts, 1, 'A failed/ambiguous transaction must not be retried by the application');
assert.equal(await firebaseOperation(async () => 42, 'CAS transaction'), 42);

const first = initializeFirebaseStore({ FIREBASE_DATABASE_URL: 'https://first-test.firebaseio.com', FIREBASE_DATABASE_PATH: '/isolated_a' });
const second = initializeFirebaseStore({ FIREBASE_DATABASE_URL: 'https://second-test.firebaseio.com', FIREBASE_DATABASE_PATH: '/isolated_b' });
assert.notEqual(first.toString(), second.toString());
const apps = getApps().filter(app => app.name.startsWith('license-api'));
assert.equal(apps.length, 2, 'Different configuration must not reuse an old app');
assert(apps.some(app => app.options.databaseURL === 'https://second-test.firebaseio.com'));
await Promise.all(getApps().filter(app => app.name.startsWith('license-api')).map(app => deleteApp(app)));

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'license-migration-guard-'));
try {
  const source = path.join(directory, 'source.json');
  fs.writeFileSync(source, JSON.stringify({admin:{username:'test',password_hash:'test-hash'},resellers:[],prices:[],keys:[],sessions:[],balance_logs:[]}));
  for (const destination of ['/license_api', '/license_api/child', '/parent']) {
    const env = { ...process.env, FIREBASE_DATABASE_URL:'https://first-test.firebaseio.com', FIREBASE_DATABASE_PATH:destination, MIGRATION_SOURCE_FILE:source, MIGRATION_SOURCE_PATH:destination === '/parent' ? '/parent/source' : '/license_api' };
    const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'migrate.ts'], {env,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
    const code=await new Promise<number|null>(resolve=>child.once('close',resolve));clearTimeout(timer);
    assert.notEqual(code,0);assert.match(output,/destination must be separate/);
  }
} finally { fs.rmSync(directory,{recursive:true,force:true}); }
console.log('Firebase safety checks passed: no transaction replay, configuration isolation, preserved-source namespace guards.');
