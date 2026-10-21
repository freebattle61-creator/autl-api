import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const listener=net.createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const port=(listener.address() as net.AddressInfo).port;await new Promise<void>(r=>listener.close(()=>r()));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'license-maintenance-'));
const database=path.join(directory,'must-not-exist.sqlite');
const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),LICENSE_API_MAINTENANCE:'1',LICENSE_DB_FILE:database,FIREBASE_DATABASE_URL:'https://invalid.example',ADMIN_PASSWORD:''},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
try{
 let ready=false;
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Maintenance startup failed');try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);const body=await r.json();assert.equal(body.storage,'maintenance');assert.equal(body.maintenance,true);ready=true;break;}catch{}await new Promise(r=>setTimeout(r,50));}
 assert.equal(ready,true);
 for(const endpoint of ['/api/auth/login','/api/admin/generate','/api/activate','/api/heartbeat']){const r=await fetch(`http://127.0.0.1:${port}${endpoint}`,{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}});assert.equal(r.status,503);assert.equal(r.headers.get('Retry-After'),'120');}
 assert.equal(fs.existsSync(database),false);assert.match(output,/database is not connected/);
 console.log('Maintenance checks passed: ready without database, all API writes denied, no SQLite file created.');
}finally{if(child.exitCode===null&&child.signalCode===null){const closed=new Promise(r=>child.once('close',r));child.kill('SIGTERM');await closed;}fs.rmSync(directory,{recursive:true,force:true});}
