import type { Request, Response, NextFunction, Express } from 'express';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const MAX_BODY = 2 * 1024 * 1024;
const ID = /^[0-9a-f]{64}$/;
const CONTENT_TYPE = /^application\/x-ndjson(?:\s*;\s*[^;=]+=[^;]+)*$/i;

type JsonObject = Record<string, unknown>;
export interface FirebaseReference {
  key: string | null;
  parent?: FirebaseReference | null;
  child(path: string): FirebaseReference;
  once(event: string): Promise<{ val(): unknown }>;
  set(value: unknown): Promise<void>;
  transaction(update: (current: unknown) => unknown): Promise<{ committed: boolean; snapshot?: { val(): unknown } }>;
}
export interface DiagnosticsOptions {
  /** The license-state reference. Diagnostics are written to its sibling, never below it. */
  firebase?: FirebaseReference;
  /** An already-open node:sqlite DatabaseSync, used when Firebase is not configured. */
  sqlite?: DatabaseSync;
  receiveLogs?: boolean;
}

function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
function isObject(v: unknown): v is JsonObject { return !!v && typeof v === 'object' && !Array.isArray(v); }
function stringField(o: JsonObject, name: string, max: number, required = false): string {
  const v = o[name];
  if (typeof v !== 'string' || (required && !v) || v.length > max) fail(`${name} is invalid`);
  return v as string;
}
function intField(o: JsonObject, name: string): number {
  const v = o[name];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) fail(`${name} is invalid`);
  return v;
}
function validate(meta: unknown, records: unknown[]): { meta: JsonObject; records: JsonObject[] } {
  if (!isObject(meta)) fail('metadata must be an object');
  if (meta.format !== 2) fail('format must be 2');
  stringField(meta, 'id', 64); if (!ID.test(meta.id as string)) fail('id is invalid');
  stringField(meta, 'installation', 512, true); intField(meta, 'createdAt');
  stringField(meta, 'loader', 512); stringField(meta, 'runtime', 512); stringField(meta, 'device', 150);
  if (!Array.isArray(meta.failures) || meta.failures.length < 1 || meta.failures.length > 16) fail('failures is invalid');
  const seen = new Set<string>();
  for (const f of meta.failures) {
    if (!isObject(f)) fail('failure is invalid');
    stringField(f, 'id', 64); if (!ID.test(f.id as string) || seen.has(f.id as string)) fail('failure id is invalid'); seen.add(f.id as string);
    stringField(f, 'build', 512); stringField(f, 'operation', 120); stringField(f, 'message', 480);
  }
  if (records.length < 1) fail('at least one record is required');
  for (const r of records) {
    if (!isObject(r)) fail('record must be an object');
    intField(r, 'time'); stringField(r, 'build', 512); stringField(r, 'process', 512); stringField(r, 'thread', 512);
    stringField(r, 'operation', 120); stringField(r, 'message', 16000); stringField(r, 'trace', 64000);
    if (r.failure !== undefined) stringField(r, 'failure', 512, false);
  }
  return { meta, records: records as JsonObject[] };
}

async function readBody(req: Request): Promise<string> {
  const declared = req.headers['content-length'];
  let expected: number | undefined;
  if (declared !== undefined) { if (Array.isArray(declared) || !/^\d+$/.test(declared)) fail('invalid Content-Length'); expected = Number(declared); if (!Number.isSafeInteger(expected) || expected > MAX_BODY) fail('request too large', 413); }
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0; let settled = false;
    const done = (err?: Error, value?: string) => { if (settled) return; settled = true; err ? reject(err) : resolve(value ?? ''); };
    req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_BODY) { done(Object.assign(new Error('request too large'), { status: 413 })); req.destroy(); return; } chunks.push(chunk); });
    req.on('end', () => { if (expected !== undefined && expected !== size) done(Object.assign(new Error('Content-Length mismatch'), { status: 400 })); else { try { done(undefined, new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { done(Object.assign(new Error('body is not valid UTF-8'), { status: 400 })); } } });
    req.on('aborted', () => done(Object.assign(new Error('request aborted'), { status: 400 }))); req.on('error', e => done(e));
  });
}
function parseBody(raw: string) {
  if (!raw || !raw.endsWith('\n')) fail('NDJSON must end with newline');
  const lines = raw.split('\n'); lines.pop(); if (!lines.length || lines.some(line => !line.trim())) fail('invalid NDJSON line');
  let meta: unknown; const records: unknown[] = [];
  try { meta = JSON.parse(lines[0]); for (const line of lines.slice(1)) records.push(JSON.parse(line)); } catch { fail('invalid JSON'); }
  return validate(meta, records);
}
function payloadHash(meta: JsonObject, records: JsonObject[]) { return createHash('sha256').update(JSON.stringify(meta) + '\n' + records.map(record => JSON.stringify(record)).join('\n') + '\n').digest('hex'); }

async function saveSqlite(db: DatabaseSync, id: string, hash: string, meta: JsonObject, records: JsonObject[]) {
  db.exec(`CREATE TABLE IF NOT EXISTS diagnostics_batches (batch_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, metadata_json TEXT NOT NULL, records_json TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  const old = db.prepare('SELECT payload_hash FROM diagnostics_batches WHERE batch_id=?').get(id) as { payload_hash: string } | undefined;
  if (old) { if (old.payload_hash !== hash) fail('batch id already exists with different payload', 409); return; }
  db.prepare('INSERT INTO diagnostics_batches(batch_id,payload_hash,metadata_json,records_json,created_at) VALUES(?,?,?,?,?)').run(id, hash, JSON.stringify(meta), JSON.stringify(records), Date.now());
}
async function saveFirebase(ref: FirebaseReference, id: string, hash: string, meta: JsonObject, records: JsonObject[]) {
  if (!ref.parent || !ref.key) throw new Error('Firebase license reference must have parent and key');
  const store = ref.parent.child(ref.key + '_diagnostics');
  let conflict = false;
  const result = await store.child(id).transaction(current => {
    if (current == null) return { payloadHash: hash, metadataJson: JSON.stringify(meta), recordsJson: JSON.stringify(records), createdAt: Date.now() };
    if (!isObject(current) || current.payloadHash !== hash) conflict = true;
    return current;
  });
  if (conflict || !result.committed) fail('batch id already exists with different payload', 409);
}

export function mountDiagnostics(app: Express, options: DiagnosticsOptions): void {
  if ((!options.firebase && !options.sqlite) || (options.firebase && options.sqlite)) throw new Error('Provide exactly one diagnostics store');
  const receiveLogs = options.receiveLogs ?? (process.env.DIAGNOSTICS_RECEIVE_LOGS ?? 'true').toLowerCase() !== 'false';
  const limits = new Map<string, { count: number; reset: number }>();
  const allowed = () => receiveLogs;
  app.get('/api/diagnostics', (_req, res) => res.status(200).json({ receiveLogs: allowed() }));
  app.post('/api/diagnostics', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!allowed()) return res.status(403).json({ error: 'diagnostics uploads are disabled' });
      const ip = req.ip || req.socket.remoteAddress || 'unknown'; const now = Date.now(); const prior = limits.get(ip);
      if (!prior || prior.reset <= now) { if (limits.size > 1024) limits.delete(limits.keys().next().value!); limits.set(ip, { count: 1, reset: now + 60_000 }); }
      else if (++prior.count > 30) return res.status(429).json({ error: 'rate limit exceeded' });
      if (!CONTENT_TYPE.test(String(req.headers['content-type'] || ''))) return res.status(415).json({ error: 'Content-Type must be application/x-ndjson' });
      const { meta, records } = parseBody(await readBody(req)); const hash = payloadHash(meta, records);
      if (options.sqlite) await saveSqlite(options.sqlite, meta.id as string, hash, meta, records); else await saveFirebase(options.firebase!, meta.id as string, hash, meta, records);
      return res.status(200).json({ id: meta.id, accepted: (meta.failures as JsonObject[]).map(f => f.id).slice(0, 256) });
    } catch (e) { const status = Number((e as any)?.status) || 500; if (status >= 500) return next(e); return res.status(status).json({ error: (e as Error).message }); }
  });
}
