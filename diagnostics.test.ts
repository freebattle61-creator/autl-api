import express from 'express';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { mountDiagnostics, type FirebaseReference } from './diagnostics';

const id = 'a'.repeat(64), failure = 'b'.repeat(64);
const meta = (over: Record<string, unknown> = {}) => ({ format: 2, id, installation: 'install', createdAt: 1, loader: 'loader', runtime: 'runtime', device: 'device', failures: [{ id: failure, build: 'b', operation: 'op', message: 'm' }], ...over });
const rec = (over: Record<string, unknown> = {}) => ({ time: 2, build: 'b', process: 'p', thread: 't', operation: 'op', message: 'msg', trace: '', ...over });
const ndjson = (m = meta(), r = rec()) => JSON.stringify(m) + '\n' + JSON.stringify(r) + '\n';
function errorApp() { const app = express(); app.use((req, _res, next) => { req.ip; next(); }); return app; }
async function serve(app: express.Express) {
  app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: String(err?.message || err) }));
  const server = app.listen(0); await new Promise<void>(r => server.once('listening', () => r()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  return { server, post: (body: BodyInit, headers: Record<string, string> = { 'content-type': 'application/x-ndjson' }) => fetch(base + '/api/diagnostics', { method: 'POST', headers, body }), get: () => fetch(base + '/api/diagnostics') };
}
async function oversized(port: number) { return new Promise<number>(resolve => { const q = httpRequest({ hostname: '127.0.0.1', port, path: '/api/diagnostics', method: 'POST', headers: { 'content-type': 'application/x-ndjson', 'content-length': 2 * 1024 * 1024 + 1 } }, r => { r.resume(); r.on('end', () => resolve(r.statusCode || 0)); }); q.end('tiny'); }); }

const db = new DatabaseSync(':memory:');
const app = express(); mountDiagnostics(app, { sqlite: db });
const { server, post, get } = await serve(app);
try {
  let r = await get(); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { receiveLogs: true });
  const unknown = { nullValue: null, array: [1, { x: true, '$bad': '#/[].' }], '$meta': { '#': 'x', '.': 'y', '[': 'z' } };
  r = await post(ndjson(meta({ extra: { arbitrary: unknown } }), rec({ nested: unknown, failure: '' }))); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { id, accepted: [failure] });
  const saved = db.prepare('SELECT metadata_json,records_json FROM diagnostics_batches WHERE batch_id=?').get(id) as any;
  assert.deepEqual(JSON.parse(saved.metadata_json).extra, { arbitrary: unknown }); assert.deepEqual(JSON.parse(saved.records_json)[0].nested, unknown); assert.equal(JSON.parse(saved.records_json)[0].trace, '');
  r = await post(ndjson(meta({}), rec({ message: 'different' }))); assert.equal(r.status, 409);
  r = await post(ndjson(meta({}), rec()), { 'content-type': 'application/json' }); assert.equal(r.status, 415);
  for (const [m, q] of [[meta(), '{'], [meta({ id: 'x' }), rec()], [meta({ failures: [{ id: failure, build: 'b', operation: 'op', message: 'm' }, { id: failure, build: 'b', operation: 'op', message: 'm' }] }), rec()], [meta({ failures: Array.from({ length: 17 }, (_, i) => ({ id: i.toString(16).padStart(64, '0'), build: 'b', operation: 'op', message: 'm' })) }), rec()], [meta({ device: 'x'.repeat(151) }), rec()], [meta(), rec({ operation: 'x'.repeat(121) })], [meta({ failures: [{ id: failure, build: 'b', operation: 'op', message: 'x'.repeat(481) }] }), rec()], [meta(), rec({ message: 'x'.repeat(16001) })], [meta(), rec({ trace: 'x'.repeat(64001) })]] as any[]) {
    r = await post(typeof q === 'string' ? JSON.stringify(m) + '\n' + q + '\n' : ndjson(m, q)); assert.equal(r.status, 400);
  }
  r = await post(JSON.stringify(meta()) + '\n'); assert.equal(r.status, 400);
  r = await post(Buffer.from([0xff, 0xfe, 0x0a]), { 'content-type': 'application/x-ndjson' }); assert.equal(r.status, 400);
  assert.equal(await oversized((server.address() as any).port), 413);
} finally { await new Promise<void>(r => server.close(() => r())); db.close(); }

const disabled = express(); mountDiagnostics(disabled, { sqlite: new DatabaseSync(':memory:'), receiveLogs: false });
const d = await serve(disabled); try { let r = await d.get(); assert.deepEqual(await r.json(), { receiveLogs: false }); r = await d.post(ndjson()); assert.equal(r.status, 403); } finally { await new Promise<void>(r => d.server.close(() => r())); }

const dir = mkdtempSync(join(tmpdir(), 'diag-')), file = join(dir, 'data.sqlite');
const db1 = new DatabaseSync(file); const a1 = express(); mountDiagnostics(a1, { sqlite: db1 }); const s1 = await serve(a1); try { assert.equal((await s1.post(ndjson(meta({ id: 'c'.repeat(64) })))).status, 200); } finally { await new Promise<void>(r => s1.server.close(() => r())); db1.close(); }
const db2 = new DatabaseSync(file); assert.equal((db2.prepare('SELECT count(*) n FROM diagnostics_batches').get() as any).n, 1); db2.close(); rmSync(dir, { recursive: true, force: true });

const state = new Map<string, any>(); const calls: string[] = []; let retry = true;
const ref = (key: string, parent?: FirebaseReference | null): FirebaseReference => ({ key, parent, child: (p: string) => { calls.push(`${key}/${p}`); return ref(p, ref(key, parent)); }, once: async () => ({ val: () => state.get(key) }), set: async v => { state.set(key, v); }, transaction: async update => { const before = state.get(key); const first = update(before); if (retry) { retry = false; update(before); } state.set(key, first); return { committed: true, snapshot: { val: () => first } }; } });
const root: any = { key: 'license', parent: { key: 'root', child: (p: string) => ref(p, null) }, child: (p: string) => ref(p, null) };
const fa = express(); mountDiagnostics(fa, { firebase: root }); const fs = await serve(fa); try {
  let r = await fs.post(ndjson(meta({ id: 'd'.repeat(64), firebaseUnknown: { '$': '#/[]' } }), rec({ arbitrary: { '#': '$', '.': '[' } }))); assert.equal(r.status, 200); assert.ok(calls.length === 0 || calls.some(x => x.includes('_diagnostics')));
  const conflict = { ...root, parent: { ...root.parent, child: (p: string) => ({ ...ref(p, null), child: () => ({ transaction: async () => ({ committed: false }) }) }) } }; const ca = express(); mountDiagnostics(ca, { firebase: conflict }); const cs = await serve(ca); try { r = await cs.post(ndjson(meta({ id: 'e'.repeat(64) }))); assert.equal(r.status, 409); } finally { await new Promise<void>(x => cs.server.close(() => x())); }
} finally { await new Promise<void>(r => fs.server.close(() => r())); }

const closed = new DatabaseSync(':memory:'); const ea = express(); mountDiagnostics(ea, { sqlite: closed }); closed.close(); const es = await serve(ea); try { const r = await es.post(ndjson(meta({ id: 'f'.repeat(64) }))); assert.equal(r.status, 500); } finally { await new Promise<void>(r => es.server.close(() => r())); }
console.log('diagnostics tests passed');
