import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { firebaseOptions } from './firebase-store';

assert.throws(() => firebaseOptions({}), /FIREBASE_DATABASE_URL/);
assert.throws(() => firebaseOptions({FIREBASE_DATABASE_URL:'https://test.firebaseio.com', FIREBASE_DATABASE_PATH:'/'}), /non-root/);
assert.throws(() => firebaseOptions({FIREBASE_DATABASE_URL:'http://test.firebaseio.com'}), /HTTPS/);

async function rejected(envOverrides:NodeJS.ProcessEnv, existingCorrupt=false) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'license-startup-'));
  try {
    fs.copyFileSync(path.resolve('server.js'),path.join(directory,'server.js'));
    fs.writeFileSync(path.join(directory,'package.json'),'{"type":"module"}\n');
    fs.symlinkSync(path.resolve('node_modules'),path.join(directory,'node_modules'),'dir');
    const file=path.join(directory,'private.sqlite');
    if(existingCorrupt){
      const db=new DatabaseSync(file);
      db.exec('CREATE TABLE state(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,value TEXT NOT NULL)');
      db.prepare('INSERT INTO state VALUES(1,0,?)').run(JSON.stringify({admin:{username:'',password_hash:''},resellers:[],prices:[],keys:[{id:1}],sessions:[],balance_logs:[]}));
      db.close();
    }
    const env:NodeJS.ProcessEnv={...process.env};
    for(const key of Object.keys(env)) if(key.startsWith('FIREBASE_') || key==='GOOGLE_APPLICATION_CREDENTIALS' || key==='ADMIN_PASSWORD') delete env[key];
    Object.assign(env,{NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',LICENSE_DB_FILE:file},envOverrides);
    const child=spawn(process.execPath,[path.join(directory,'server.js')],{cwd:directory,env});
    let output=''; child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
    const code=await new Promise<number|null>(resolve=>child.on('close',resolve));clearTimeout(timer);
    assert.equal(code,1);assert.doesNotMatch(output,/Server running/);
    if(existingCorrupt){
      const db=new DatabaseSync(file);
      const row=db.prepare('SELECT value FROM state').get() as any;
      assert.equal(JSON.parse(row.value).keys.length,1,'incompatible existing records must not be overwritten');db.close();
      assert.match(output,/Incompatible nonempty SQLite schema/);
    }
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
}
await rejected({});
await rejected({FIREBASE_DATABASE_URL:'https://invalid.example',ADMIN_PASSWORD:'isolated-startup-fixture'});
await rejected({ADMIN_PASSWORD:'isolated-startup-fixture'},true);
console.log('Startup checks passed: missing admin fails closed, invalid Firebase URL rejected, incompatible SQLite data preserved.');
