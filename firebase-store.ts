import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

export function firebaseOptions(env: NodeJS.ProcessEnv = process.env, baseDir = process.cwd()) {
  const databaseURL = env.FIREBASE_DATABASE_URL?.trim();
  if (!databaseURL) throw new Error('Set FIREBASE_DATABASE_URL to your Firebase Realtime Database URL.');
  let url: URL;
  try { url = new URL(databaseURL); } catch { throw new Error('FIREBASE_DATABASE_URL must be a valid HTTPS URL.'); }
  if (url.protocol !== 'https:' || !/\.(firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('FIREBASE_DATABASE_URL must be an HTTPS Firebase RTDB instance URL, without a path or query.');
  }
  const databasePath = env.FIREBASE_DATABASE_PATH?.trim() || '/license_api';
  if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(databasePath)) {
    throw new Error('FIREBASE_DATABASE_PATH must be a non-root path such as /license_api.');
  }
  let account: any;
  const inline = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const base64 = env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  const file = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  try {
    if (inline) account = JSON.parse(inline);
    else if (base64) account = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    else if (file) account = JSON.parse(fs.readFileSync(path.resolve(baseDir, file), 'utf8'));
  } catch {
    throw new Error('Firebase service-account JSON is unreadable or invalid. Check the credential environment variable or secret file.');
  }
  if (account) {
    if (typeof account.project_id !== 'string' || typeof account.client_email !== 'string' || typeof account.private_key !== 'string') {
      throw new Error('Firebase service account requires project_id, client_email and private_key.');
    }
    account.private_key = account.private_key.replace(/\\n/g, '\n');
  }
  return { databaseURL, databasePath, credential: account ? cert(account) : applicationDefault() };
}

export function initializeFirebaseStore(env: NodeJS.ProcessEnv = process.env, baseDir = process.cwd()) {
  const options = firebaseOptions(env, baseDir);
  const identity = JSON.stringify([options.databaseURL, options.databasePath, env.FIREBASE_SERVICE_ACCOUNT_JSON || '', env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '', env.GOOGLE_APPLICATION_CREDENTIALS || '']);
  const name = 'license-api-' + crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
  const app = getApps().find(app => app.name === name) || initializeApp({ credential: options.credential, databaseURL: options.databaseURL }, name);
  return getDatabase(app).ref(options.databasePath);
}

export async function firebaseOperation<T>(operation: () => Promise<T>, label: string): Promise<T> {
  // Only reads can be safely retried after an application timeout. Firebase SDK
  // transactions already retry conflicts; never overlap them with a second write.
  if (label !== 'read') {
    try { return await operation(); }
    catch { throw new Error(`Firebase ${label} failed. Check credentials, database URL, permissions and network connectivity.`); }
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 15000); })
      ]);
    } catch {
      if (attempt === 3) throw new Error(`Firebase ${label} failed after 3 attempts. Check credentials, database URL, permissions and network connectivity.`);
      console.warn(`Firebase ${label} temporarily unavailable; retry ${attempt}/2.`);
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    } finally { if (timer) clearTimeout(timer); }
  }
  throw new Error(`Firebase ${label} failed.`);
}
