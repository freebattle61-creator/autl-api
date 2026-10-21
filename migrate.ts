import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { initializeFirebaseStore, firebaseOperation } from './firebase-store';

dotenv.config({ path: path.join(process.cwd(), '.env'), quiet: true });
const source = process.env.MIGRATION_SOURCE_FILE?.trim();
const allow = process.env.MIGRATION_ALLOW_WRITE === '1';
if (!source) throw new Error('Set MIGRATION_SOURCE_FILE to an explicit JSON file');
if (!process.env.FIREBASE_DATABASE_URL || !process.env.FIREBASE_DATABASE_PATH) throw new Error('Set FIREBASE_DATABASE_URL and a non-root FIREBASE_DATABASE_PATH');
if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(process.env.FIREBASE_DATABASE_PATH)) throw new Error('FIREBASE_DATABASE_PATH must be a non-root path');

async function main() {
  const raw = JSON.parse(fs.readFileSync(path.resolve(source!), 'utf8'));
  if (!raw?.admin?.username || !raw?.admin?.password_hash) throw new Error('Source must contain an admin credential hash');
  const fields = ['resellers', 'prices', 'keys', 'sessions', 'balance_logs'];
  if (fields.some(field => !Array.isArray(raw[field]))) throw new Error('Source must contain all six API data fields with array values');
  const data = { admin: raw.admin, resellers: raw.resellers, prices: raw.prices, keys: raw.keys, sessions: raw.sessions, balance_logs: raw.balance_logs };
  const ref = initializeFirebaseStore(process.env, process.cwd());
  if (!allow) { console.log('Dry run only; source validated and no destination read/write was performed. Set MIGRATION_ALLOW_WRITE=1 to commit.'); return; }
  const result = await firebaseOperation(() => ref.transaction((current: any) => current === null ? { ...data, revision: 1 } : undefined), 'migration CAS');
  if (!result.committed) throw new Error('Destination is no longer empty; refusing overwrite');
  console.log('Migration completed to the configured isolated path with all six data fields.');
}
main().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
