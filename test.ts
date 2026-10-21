import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const port = 8327;
const db = path.join(os.tmpdir(), `license-api-http-${process.pid}.sqlite`);
try { fs.unlinkSync(db); } catch {}
const env:NodeJS.ProcessEnv = { ...process.env, NODE_ENV:'production', HOST:'127.0.0.1', PORT:String(port), LICENSE_DB_FILE:db, ADMIN_USERNAME:'testadmin', ADMIN_PASSWORD:'test-only-password', SESSION_TTL_SECONDS:'120' };
for(const name of Object.keys(env)) if(name.startsWith('FIREBASE_')||name==='GOOGLE_APPLICATION_CREDENTIALS') delete env[name];
let child: ChildProcess | undefined;
const base = `http://127.0.0.1:${port}`;
async function request(pathname:string, body?:unknown, headers:Record<string,string>={}) { const r=await fetch(base+pathname,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}); return {status:r.status,body:await r.json() as any}; }
async function start() { child=spawn(process.execPath,[path.resolve('server.js')],{env,stdio:'ignore'}); for(let i=0;i<60;i++){try{const r=await fetch(base+'/api/health');if(r.ok)return;}catch{} await new Promise(r=>setTimeout(r,100));} throw new Error('server did not start'); }
async function stop(){if(child){child.kill('SIGTERM'); await new Promise(r=>setTimeout(r,200)); child=undefined;}}
async function main(){
 await start();
 assert.deepEqual((await request('/api/health')).body.ready,true);
 const login=await request('/api/auth/login',{username:'testadmin',password:'test-only-password'}); assert.equal(login.status,200); const auth={authorization:`Bearer ${login.body.token}`};
 assert.equal((await request('/api/admin/generate',{duration:7,count:1,max_devices:2},auth)).status,200);
 const dbh=new DatabaseSync(db); const key=(JSON.parse((dbh.prepare('SELECT value FROM state').get() as any).value)).keys[0].key_value;
 const act=await request('/api/activate',{license_key:key,device_fingerprint:'device-a'}); assert.equal(act.status,200); assert.equal(act.body.success,true); assert.ok(act.body.session_id); assert.ok(act.body.expires_at); assert.ok(act.body.session_expires_at);
 assert.equal((await request('/api/heartbeat',{key,session_id:act.body.session_id,hwid:'device-a'})).body.success,true);
 assert.equal((await request('/api/activate',{license_key:key,key:'different',hwid:'x',device_fingerprint:'x'})).status,400);
 assert.equal((await request('/api/activate',{license_key:'not-real',device_fingerprint:'x'})).status,404);
 assert.equal((await request('/api/activate',{license_key:key,device_fingerprint:'device-b'})).status,200);
 assert.equal((await request('/api/activate',{license_key:key,device_fingerprint:'device-c'})).status,403);
 assert.equal((await request('/api/admin/key/reset-devices/1',{},auth)).status,200);
 assert.equal((await request('/api/heartbeat',{license_key:key,session_id:act.body.session_id,device_fingerprint:'device-a'})).status,401);
 // Expiry fixture is isolated to this temporary SQLite database, never production data.
 const row=JSON.parse((dbh.prepare('SELECT value FROM state').get() as any).value); const k=row.keys.find((x:any)=>x.key_value===key); k.expires_at=new Date(Date.now()-1000).toISOString(); dbh.prepare('UPDATE state SET value=value').run(); dbh.prepare('UPDATE state SET value=?').run(JSON.stringify(row));
 assert.equal((await request('/api/activate',{license_key:key,device_fingerprint:'device-a'})).status,400);
 await stop(); await start(); assert.equal((await request('/api/health')).status,200); assert.equal((await request('/api/auth/login',{username:'testadmin',password:'test-only-password'})).status,200);
 await stop(); try{fs.unlinkSync(db);fs.unlinkSync(db+'-shm');fs.unlinkSync(db+'-wal');}catch{}
 console.log('HTTP regression tests passed: health, admin generation, aliases, activation, heartbeat, invalid/conflict, max devices, reset/revocation, expiry fixture, restart persistence');
}
main().catch(async e=>{await stop();try{fs.unlinkSync(db)}catch{};console.error(e);process.exit(1)});
