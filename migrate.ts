import * as adminImport from 'firebase-admin';
const admin = (adminImport as any).default || adminImport;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, 'database.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://poised-balancer-9t8c4-default-rtdb.firebaseio.com'
  });
}

async function migrate() {
  if (!fs.existsSync(DB_FILE)) {
    console.log('No database.json found to migrate.');
    return;
  }
  const content = fs.readFileSync(DB_FILE, 'utf-8');
  const data = JSON.parse(content);

  const rtdb = admin.database();
  const rootRef = rtdb.ref('/');

  console.log('Starting migration of database.json to Firebase Realtime Database...');
  await rootRef.set({
    admin: data.admin || { username: 'shadowcracker', password_hash: '' },
    resellers: data.resellers || [],
    prices: data.prices || [],
    keys: data.keys || [],
    sessions: data.sessions || [],
    balance_logs: data.balance_logs || []
  });

  console.log('Migration completed successfully!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
