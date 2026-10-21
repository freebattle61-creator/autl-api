import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import * as adminImport from 'firebase-admin';
const admin = (adminImport as any).default || adminImport;

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize Firebase Admin SDK safely with local JSON fallback
let rtdb: any = null;
try {
  if (admin && admin.apps && !admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://poised-balancer-9t8c4-default-rtdb.firebaseio.com'
    });
    console.log('Firebase Admin SDK initialized successfully.');
  }
  if (admin && admin.database) {
    rtdb = admin.database();
  }
} catch (e) {
  console.warn('Firebase Admin SDK could not be initialized (using local JSON storage fallback):', e);
}

interface KeyItem {
  id: number;
  key_value: string;
  duration_days: number;
  max_devices: number;
  hwid_list: string[];
  hwid?: string;
  is_disabled?: number;
  created_at: string;
  created_by: string;
  reseller_id?: number;
  activated_at?: string;
  expires_at?: string;
  note?: string;
}

interface SessionItem {
  session_id: string;
  key_value: string;
  hwid: string;
  created_at: string;
  last_heartbeat: string;
  expires_at: string;
}

interface DbSchema {
  admin: { username: string; password_hash: string };
  resellers: Array<{
    id: number;
    username: string;
    password_hash: string;
    balance: number;
    is_active: number;
    created_at: string;
    note?: string;
  }>;
  prices: Array<{
    duration_days: number;
    price: number;
  }>;
  keys: KeyItem[];
  sessions: SessionItem[];
  balance_logs: Array<{
    id: number;
    reseller_id: number;
    amount: number;
    reason: string;
    created_at: string;
  }>;
}

const DB_FILE = path.join(__dirname, 'database.json');

let dbData: DbSchema = {
  admin: { username: 'shadowcracker', password_hash: bcrypt.hashSync('Sh@d0w_Cr@ck3r_X9#99!Secure', 10) },
  resellers: [
    { id: 1, username: 'reseller1', password_hash: bcrypt.hashSync('reseller123', 10), balance: 150.0, is_active: 1, created_at: new Date().toISOString(), note: 'VIP Reseller' }
  ],
  prices: [
    { duration_days: 1, price: 5 },
    { duration_days: 3, price: 12 },
    { duration_days: 7, price: 25 },
    { duration_days: 30, price: 80 },
    { duration_days: 365, price: 500 }
  ],
  keys: [],
  sessions: [],
  balance_logs: []
};

async function loadDb() {
  if (rtdb) {
    try {
      const snap = await rtdb.ref('/').once('value');
      const val = snap.val();
      if (val) {
        dbData = {
          admin: val.admin || dbData.admin,
          resellers: val.resellers || dbData.resellers,
          prices: val.prices || dbData.prices,
          keys: val.keys || [],
          sessions: val.sessions || [],
          balance_logs: val.balance_logs || []
        };
        console.log('Database loaded from Firebase Realtime Database.');
        return;
      }
    } catch (e) {
      console.warn('Firebase load failed, falling back to local database.json:', e);
    }
  }

  // Fallback to local database.json
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      const val = JSON.parse(content);
      dbData = {
        admin: val.admin || dbData.admin,
        resellers: val.resellers || dbData.resellers,
        prices: val.prices || dbData.prices,
        keys: val.keys || [],
        sessions: val.sessions || [],
        balance_logs: val.balance_logs || []
      };
      console.log('Database loaded from local database.json.');
    } else {
      const adminUser = process.env.ADMIN_USERNAME || 'shadowcracker';
      const adminPass = process.env.ADMIN_PASSWORD || 'Sh@d0w_Cr@ck3r_X9#99!Secure';
      dbData.admin = { username: adminUser, password_hash: bcrypt.hashSync(adminPass, 10) };
      await saveDb();
      console.log('Created and seeded initial local database.json.');
    }
  } catch (e) {
    console.error('Error loading local database.json:', e);
  }
}

async function saveDb() {
  if (rtdb) {
    try {
      await rtdb.ref('/').set(dbData);
    } catch (e) {
      console.error('Firebase save warning:', e);
    }
  }

  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving local database.json:', e);
  }
}

function generateKey(): string {
  const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const part3 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const part4 = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `SH-${part1}-${part2}-${part3}-${part4}`;
}

async function startServer() {
  await loadDb();

  const app = express();
  app.use(express.json());

  const webSessions = new Map<string, { role: 'admin' | 'reseller', username: string, reseller_id?: number }>();

  // Login
  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }

    if (dbData.admin.username === username && await bcrypt.compare(password, dbData.admin.password_hash)) {
      const token = crypto.randomBytes(16).toString('hex');
      webSessions.set(token, { role: 'admin', username: dbData.admin.username });
      return res.json({ success: true, role: 'admin', token, username: dbData.admin.username });
    }

    const reseller = dbData.resellers.find(r => r.username === username);
    if (reseller && await bcrypt.compare(password, reseller.password_hash)) {
      if (!reseller.is_active) {
        return res.status(403).json({ success: false, message: 'Reseller account is disabled' });
      }
      const token = crypto.randomBytes(16).toString('hex');
      webSessions.set(token, { role: 'reseller', username: reseller.username, reseller_id: reseller.id });
      return res.json({ success: true, role: 'reseller', token, username: reseller.username, balance: reseller.balance });
    }

    return res.status(401).json({ success: false, message: 'Invalid credentials. Check Shadow Cracker credentials.' });
  });

  const requireAuth = (role?: 'admin' | 'reseller') => {
    return (req: any, res: any, next: any) => {
      const authHeader = req.headers['authorization'] || req.headers['Authorization'];
      const token = authHeader?.replace('Bearer ', '') || req.query.token;
      const session = webSessions.get(token);
      if (!session) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      if (role && session.role !== role && session.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
      req.user = session;
      next();
    };
  };

  // Admin Data
  app.get('/api/admin/data', requireAuth('admin'), async (req: any, res: any) => {
    await loadDb();
    const total = dbData.keys.length;
    const used = dbData.keys.filter(k => k.activated_at).length;
    let totalDevices = 0;
    dbData.keys.forEach(k => {
      if (k.hwid_list) totalDevices += k.hwid_list.length;
    });

    res.json({
      success: true,
      keys: [...dbData.keys].reverse().slice(0, 100),
      resellers: dbData.resellers.map(r => ({ id: r.id, username: r.username, balance: r.balance, is_active: r.is_active, created_at: r.created_at, note: r.note })),
      prices: dbData.prices,
      stats: { 
        total, 
        used, 
        unused: total - used,
        totalDevices
      },
      api_url: `${req.protocol}://${req.get('host')}/api/activate`
    });
  });

  // Admin Generate Keys
  app.post('/api/admin/generate', requireAuth('admin'), async (req: any, res: any) => {
    const { duration, count = 10, max_devices = 1, note = '' } = req.body;
    const dur = parseInt(duration) || 1;
    const cnt = Math.max(1, Math.min(parseInt(count) || 1, 200));
    const maxDev = Math.max(1, parseInt(max_devices) || 1);
    const now = new Date().toISOString();
    const user = req.user.username;

    for (let i = 0; i < cnt; i++) {
      const newKey: KeyItem = {
        id: dbData.keys.length > 0 ? Math.max(...dbData.keys.map(k => k.id)) + 1 : 1,
        key_value: generateKey(),
        duration_days: dur,
        max_devices: maxDev,
        hwid_list: [],
        is_disabled: 0,
        created_at: now,
        created_by: user,
        note
      };
      dbData.keys.push(newKey);
    }
    await saveDb();
    res.json({ success: true, message: `Successfully generated ${cnt} keys` });
  });

  // Save Prices
  app.post('/api/admin/prices', requireAuth('admin'), async (req: any, res: any) => {
    const pricesObj = req.body.prices;
    if (!pricesObj) return res.status(400).json({ success: false, message: 'Invalid prices' });

    for (const [days, price] of Object.entries(pricesObj)) {
      const d = parseInt(days);
      const p = parseFloat(price as string) || 0;
      const existing = dbData.prices.find(item => item.duration_days === d);
      if (existing) {
        existing.price = p;
      } else {
        dbData.prices.push({ duration_days: d, price: p });
      }
    }
    dbData.prices.sort((a, b) => a.duration_days - b.duration_days);
    await saveDb();
    res.json({ success: true, message: 'Prices updated successfully' });
  });

  // Create Reseller
  app.post('/api/admin/reseller/create', requireAuth('admin'), async (req: any, res: any) => {
    const { username, password, balance = 100, note = '' } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }
    if (dbData.resellers.some(r => r.username === username)) {
      return res.status(400).json({ success: false, message: 'Reseller username already exists' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const newRes = {
      id: dbData.resellers.length > 0 ? Math.max(...dbData.resellers.map(r => r.id)) + 1 : 1,
      username,
      password_hash,
      balance: parseFloat(balance) || 0,
      is_active: 1,
      created_at: new Date().toISOString(),
      note
    };
    dbData.resellers.push(newRes);
    await saveDb();
    res.json({ success: true, message: 'Reseller created successfully' });
  });

  // Update Balance
  app.post('/api/admin/reseller/balance', requireAuth('admin'), async (req: any, res: any) => {
    const { reseller_id, amount, reason = 'Admin adjustment' } = req.body;
    const amt = parseFloat(amount);
    if (isNaN(amt)) return res.status(400).json({ success: false, message: 'Invalid amount' });

    const reseller = dbData.resellers.find(r => r.id === Number(reseller_id));
    if (!reseller) return res.status(404).json({ success: false, message: 'Reseller not found' });

    reseller.balance += amt;
    dbData.balance_logs.push({
      id: dbData.balance_logs.length > 0 ? Math.max(...dbData.balance_logs.map(l => l.id)) + 1 : 1,
      reseller_id: reseller.id,
      amount: amt,
      reason,
      created_at: new Date().toISOString()
    });
    await saveDb();
    res.json({ success: true, message: 'Balance updated successfully' });
  });

  // Toggle Reseller
  app.post('/api/admin/reseller/toggle/:id', requireAuth('admin'), async (req: any, res: any) => {
    const id = Number(req.params.id);
    const reseller = dbData.resellers.find(r => r.id === id);
    if (!reseller) return res.status(404).json({ success: false, message: 'Reseller not found' });
    reseller.is_active = reseller.is_active ? 0 : 1;
    await saveDb();
    res.json({ success: true, is_active: reseller.is_active });
  });

  // Delete Single Key
  const deleteKeyHandler = async (req: any, res: any) => {
    const id = Number(req.params.id);
    const key = dbData.keys.find(k => k.id === id);
    if (key) {
      dbData.sessions = dbData.sessions.filter(s => s.key_value !== key.key_value);
    }
    dbData.keys = dbData.keys.filter(k => k.id !== id);
    await saveDb();
    res.json({ success: true, message: 'Key deleted successfully' });
  };
  app.delete('/api/admin/key/:id', requireAuth('admin'), deleteKeyHandler);
  app.post('/api/admin/key/delete/:id', requireAuth('admin'), deleteKeyHandler);

  // Batch Delete Keys
  app.post('/api/admin/keys/batch-delete', requireAuth('admin'), async (req: any, res: any) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ success: false, message: 'Invalid IDs' });
    const keysToDelete = dbData.keys.filter(k => ids.includes(k.id));
    const vals = keysToDelete.map(k => k.key_value);
    dbData.sessions = dbData.sessions.filter(s => !vals.includes(s.key_value));
    dbData.keys = dbData.keys.filter(k => !ids.includes(k.id));
    await saveDb();
    res.json({ success: true, message: `Deleted ${ids.length} keys successfully` });
  });

  // Batch Reset Devices
  app.post('/api/admin/keys/batch-reset', requireAuth('admin'), async (req: any, res: any) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ success: false, message: 'Invalid IDs' });
    const vals: string[] = [];
    dbData.keys.forEach(k => {
      if (ids.includes(k.id)) {
        k.hwid_list = [];
        vals.push(k.key_value);
      }
    });
    dbData.sessions = dbData.sessions.filter(s => !vals.includes(s.key_value));
    await saveDb();
    res.json({ success: true, message: `Reset devices & revoked sessions for ${ids.length} keys` });
  });

  // Batch Disable / Enable
  app.post('/api/admin/keys/batch-status', requireAuth('admin'), async (req: any, res: any) => {
    const { ids, is_disabled } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ success: false, message: 'Invalid IDs' });
    const vals: string[] = [];
    dbData.keys.forEach(k => {
      if (ids.includes(k.id)) {
        k.is_disabled = is_disabled ? 1 : 0;
        if (is_disabled) vals.push(k.key_value);
      }
    });
    if (is_disabled) {
      dbData.sessions = dbData.sessions.filter(s => !vals.includes(s.key_value));
    }
    await saveDb();
    res.json({ success: true, message: `Updated status for ${ids.length} keys` });
  });

  // Reset Device HWID slots for a Key
  app.post('/api/admin/key/reset-devices/:id', requireAuth('admin'), async (req: any, res: any) => {
    const id = Number(req.params.id);
    const key = dbData.keys.find(k => k.id === id);
    if (!key) return res.status(404).json({ success: false, message: 'Key not found' });
    
    key.hwid_list = [];
    dbData.sessions = dbData.sessions.filter(s => s.key_value !== key.key_value);
    await saveDb();

    res.json({ success: true, message: 'Device bindings reset and sessions revoked successfully (Expiration preserved)' });
  });

  // Toggle Disable / Enable Key
  app.post('/api/admin/key/toggle-disable/:id', requireAuth('admin'), async (req: any, res: any) => {
    const id = Number(req.params.id);
    const key = dbData.keys.find(k => k.id === id);
    if (!key) return res.status(404).json({ success: false, message: 'Key not found' });
    key.is_disabled = key.is_disabled ? 0 : 1;
    if (key.is_disabled) {
      dbData.sessions = dbData.sessions.filter(s => s.key_value !== key.key_value);
    }
    await saveDb();
    res.json({ success: true, is_disabled: key.is_disabled });
  });

  // Reseller Data
  app.get('/api/reseller/data', requireAuth('reseller'), async (req: any, res: any) => {
    await loadDb();
    const rid = req.user.reseller_id;
    const reseller = dbData.resellers.find(r => r.id === rid);
    const keys = dbData.keys.filter(k => k.reseller_id === rid).reverse();
    const logs = dbData.balance_logs.filter(l => l.reseller_id === rid).reverse();
    res.json({
      success: true,
      reseller: reseller ? { id: reseller.id, username: reseller.username, balance: reseller.balance, is_active: reseller.is_active } : null,
      keys,
      prices: dbData.prices,
      logs
    });
  });

  // Reseller Generate Keys
  app.post('/api/reseller/generate', requireAuth('reseller'), async (req: any, res: any) => {
    const rid = req.user.reseller_id;
    const duration = parseInt(req.body.duration) || 1;
    const count = Math.max(1, Math.min(parseInt(req.body.count) || 1, 50));
    const maxDev = Math.max(1, parseInt(req.body.max_devices) || 1);

    const priceRow = dbData.prices.find(p => p.duration_days === duration);
    if (!priceRow) return res.status(400).json({ success: false, message: 'Invalid duration' });

    const totalCost = priceRow.price * count;
    const reseller = dbData.resellers.find(r => r.id === rid);
    if (!reseller || reseller.balance < totalCost) {
      return res.status(400).json({ success: false, message: `Insufficient balance. Need $${totalCost}, have $${reseller?.balance || 0}` });
    }

    reseller.balance -= totalCost;
    dbData.balance_logs.push({
      id: dbData.balance_logs.length > 0 ? Math.max(...dbData.balance_logs.map(l => l.id)) + 1 : 1,
      reseller_id: rid,
      amount: -totalCost,
      reason: `Generated ${count}x${duration}d keys`,
      created_at: new Date().toISOString()
    });

    const now = new Date().toISOString();
    for (let i = 0; i < count; i++) {
      dbData.keys.push({
        id: dbData.keys.length > 0 ? Math.max(...dbData.keys.map(k => k.id)) + 1 : 1,
        key_value: generateKey(),
        duration_days: duration,
        max_devices: maxDev,
        hwid_list: [],
        is_disabled: 0,
        created_at: now,
        created_by: reseller.username,
        reseller_id: rid
      });
    }
    await saveDb();
    res.json({ success: true, message: `Generated ${count} keys. Deducted $${totalCost}.` });
  });

  // ==========================================
  // API Endpoints for .so License Library Compatibility
  // ==========================================

  // 1. Activation Endpoint
  app.post('/api/activate', async (req, res) => {
    await loadDb();
    const { license_key, key, hwid, device_fingerprint, device_id } = req.body;
    const targetKey = license_key || key;
    const targetHwid = hwid || device_fingerprint || device_id;

    if (!targetKey) {
      return res.status(400).json({
        success: false,
        error_code: 1001,
        message: 'License key is required ("license_key" or "key")',
        session_id: null
      });
    }

    if (!targetHwid) {
      return res.status(400).json({
        success: false,
        error_code: 1005,
        message: 'HWID or device_fingerprint is required for device binding',
        session_id: null
      });
    }

    const kRow = dbData.keys.find(k => k.key_value === targetKey);
    if (!kRow) {
      return res.status(404).json({
        success: false,
        error_code: 1002,
        message: 'Invalid license key',
        session_id: null
      });
    }

    if (kRow.is_disabled) {
      return res.status(403).json({
        success: false,
        error_code: 1003,
        message: 'License key has been disabled by admin',
        session_id: null
      });
    }

    if (!kRow.hwid_list) kRow.hwid_list = [];
    if (!kRow.max_devices) kRow.max_devices = 1;

    const now = new Date();

    if (kRow.activated_at && kRow.expires_at) {
      const expDate = new Date(kRow.expires_at);
      if (now > expDate) {
        return res.status(400).json({
          success: false,
          error_code: 1004,
          message: 'License key has expired',
          session_id: null
        });
      }

      if (!kRow.hwid_list.includes(targetHwid)) {
        if (kRow.hwid_list.length >= kRow.max_devices) {
          return res.status(403).json({
            success: false,
            error_code: 1006,
            message: `Device limit reached (${kRow.hwid_list.length}/${kRow.max_devices})`,
            session_id: null
          });
        }
        kRow.hwid_list.push(targetHwid);
      }

      const sessionId = crypto.randomBytes(16).toString('hex');
      const sessionExpires = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      dbData.sessions.push({
        session_id: sessionId,
        key_value: targetKey,
        hwid: targetHwid,
        created_at: now.toISOString(),
        last_heartbeat: now.toISOString(),
        expires_at: sessionExpires
      });
      await saveDb();

      return res.json({
        success: true,
        error_code: 0,
        message: 'License validated successfully',
        session_id: sessionId,
        expires_at: kRow.expires_at,
        plan: `${kRow.duration_days} Days`,
        heartbeat_interval: 60,
        user: {
          expires_at: kRow.expires_at
        },
        seller: {
          name: 'Shadow Cracker'
        }
      });
    }

    const activatedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + kRow.duration_days * 24 * 60 * 60 * 1000).toISOString();
    const sessionId = crypto.randomBytes(16).toString('hex');
    const sessionExpires = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    kRow.activated_at = activatedAt;
    kRow.expires_at = expiresAt;
    kRow.hwid_list.push(targetHwid);

    dbData.sessions.push({
      session_id: sessionId,
      key_value: targetKey,
      hwid: targetHwid,
      created_at: now.toISOString(),
      last_heartbeat: now.toISOString(),
      expires_at: sessionExpires
    });
    await saveDb();

    return res.json({
      success: true,
      error_code: 0,
      message: 'License activated successfully',
      session_id: sessionId,
      expires_at: expiresAt,
      plan: `${kRow.duration_days} Days`,
      heartbeat_interval: 60,
      user: {
        expires_at: expiresAt
      },
      seller: {
        name: 'Shadow Cracker'
      }
    });
  });

  // 2. Strict Heartbeat Endpoint
  app.post('/api/heartbeat', async (req, res) => {
    await loadDb();
    const { license_key, key, session_id, hwid, device_fingerprint, device_id } = req.body;
    const targetKey = license_key || key;
    const targetHwid = hwid || device_fingerprint || device_id;

    if (!targetKey || !session_id || !targetHwid) {
      return res.status(400).json({
        success: false,
        error_code: 2001,
        message: 'license_key, session_id, and hwid/device_fingerprint are required for heartbeat'
      });
    }

    const session = dbData.sessions.find(s => s.session_id === session_id && s.key_value === targetKey);
    if (!session) {
      return res.status(401).json({
        success: false,
        error_code: 2002,
        message: 'Invalid, revoked, or expired session ID'
      });
    }

    if (session.hwid !== targetHwid) {
      return res.status(403).json({
        success: false,
        error_code: 2005,
        message: 'HWID mismatch on heartbeat'
      });
    }

    const now = new Date();
    if (now > new Date(session.expires_at)) {
      return res.status(401).json({
        success: false,
        error_code: 2006,
        message: 'Session has expired'
      });
    }

    const kRow = dbData.keys.find(k => k.key_value === targetKey);
    if (!kRow || kRow.is_disabled) {
      return res.status(403).json({
        success: false,
        error_code: 2003,
        message: 'License key is invalid or disabled'
      });
    }

    if (kRow.expires_at && now > new Date(kRow.expires_at)) {
      return res.status(400).json({
        success: false,
        error_code: 2004,
        message: 'License has expired'
      });
    }

    if (!kRow.hwid_list || !kRow.hwid_list.includes(targetHwid)) {
      return res.status(403).json({
        success: false,
        error_code: 2007,
        message: 'Device binding revoked or reset'
      });
    }

    session.last_heartbeat = now.toISOString();
    await saveDb();

    return res.json({
      success: true,
      error_code: 0,
      message: 'Heartbeat OK',
      session_id: session.session_id,
      expires_at: kRow.expires_at,
      heartbeat_interval: 60,
      user: {
        expires_at: kRow.expires_at
      },
      seller: {
        name: 'Shadow Cracker'
      }
    });
  });

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);

  const port = typeof process.env.PORT === 'string' ? parseInt(process.env.PORT, 10) : (process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();
