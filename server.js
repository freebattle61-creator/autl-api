// server.ts
import express from "express";
import { createServer as createViteServer } from "vite";
import path2 from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import fs2 from "fs";
import os from "os";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { DatabaseSync } from "node:sqlite";

// firebase-store.ts
import fs from "node:fs";
import path from "node:path";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
function firebaseOptions(env = process.env, baseDir = process.cwd()) {
  const databaseURL = env.FIREBASE_DATABASE_URL?.trim();
  if (!databaseURL) throw new Error("Set FIREBASE_DATABASE_URL to your Firebase Realtime Database URL.");
  let url;
  try {
    url = new URL(databaseURL);
  } catch {
    throw new Error("FIREBASE_DATABASE_URL must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:" || !/\.(firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("FIREBASE_DATABASE_URL must be an HTTPS Firebase RTDB instance URL, without a path or query.");
  }
  const databasePath = env.FIREBASE_DATABASE_PATH?.trim() || "/license_api";
  if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(databasePath)) {
    throw new Error("FIREBASE_DATABASE_PATH must be a non-root path such as /license_api.");
  }
  let account;
  const inline = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const base64 = env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  const file = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  try {
    if (inline) account = JSON.parse(inline);
    else if (base64) account = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
    else if (file) account = JSON.parse(fs.readFileSync(path.resolve(baseDir, file), "utf8"));
  } catch {
    throw new Error("Firebase service-account JSON is unreadable or invalid. Check the credential environment variable or secret file.");
  }
  if (account) {
    if (typeof account.project_id !== "string" || typeof account.client_email !== "string" || typeof account.private_key !== "string") {
      throw new Error("Firebase service account requires project_id, client_email and private_key.");
    }
    account.private_key = account.private_key.replace(/\\n/g, "\n");
  }
  return { databaseURL, databasePath, credential: account ? cert(account) : applicationDefault() };
}
function initializeFirebaseStore(env = process.env, baseDir = process.cwd()) {
  const options = firebaseOptions(env, baseDir);
  const name = "license-api";
  const app = getApps().find((app2) => app2.name === name) || initializeApp({ credential: options.credential, databaseURL: options.databaseURL }, name);
  return getDatabase(app).ref(options.databasePath);
}
async function firebaseOperation(operation, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let timer;
    try {
      return await Promise.race([
        operation(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), 15e3);
        })
      ]);
    } catch {
      if (attempt === 3) throw new Error(`Firebase ${label} failed after 3 attempts. Check credentials, database URL, permissions and network connectivity.`);
      console.warn(`Firebase ${label} temporarily unavailable; retry ${attempt}/2.`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw new Error(`Firebase ${label} failed.`);
}

// server.ts
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path2.join(__dirname, ".env"), quiet: true });
var DB_FILE = process.env.LICENSE_DB_FILE || path2.join(os.homedir(), ".license-api", "license.sqlite");
var sqlite = null;
var rtdb = null;
var revision = 0;
var dbData = { admin: { username: "", password_hash: "" }, resellers: [], prices: [], keys: [], sessions: [], balance_logs: [] };
var defaults = () => ({ admin: { username: "", password_hash: "" }, resellers: [], prices: [{ duration_days: 1, price: 5 }, { duration_days: 3, price: 12 }, { duration_days: 7, price: 25 }, { duration_days: 30, price: 80 }, { duration_days: 365, price: 500 }], keys: [], sessions: [], balance_logs: [] });
function validateState(v) {
  if (!v || typeof v !== "object" || !v.admin || typeof v.admin.username !== "string" || !v.admin.username || typeof v.admin.password_hash !== "string" || !v.admin.password_hash || !Array.isArray(v.resellers) || !Array.isArray(v.prices) || !Array.isArray(v.keys) || !Array.isArray(v.sessions) || !Array.isArray(v.balance_logs)) throw new Error("Configured database contains an incompatible nonempty schema; refusing overwrite.");
  return { admin: v.admin, resellers: v.resellers, prices: v.prices, keys: v.keys, sessions: v.sessions, balance_logs: v.balance_logs };
}
function conflict(message = "Database changed concurrently; retry the request") {
  const e = Object.assign(new Error(message), { status: 409, code: 1909 });
  return e;
}
async function initializeStorage() {
  process.umask(63);
  if (process.env.FIREBASE_DATABASE_URL) {
    rtdb = initializeFirebaseStore(process.env, __dirname);
    return;
  }
  fs2.mkdirSync(path2.dirname(DB_FILE), { recursive: true, mode: 448 });
  sqlite = new DatabaseSync(DB_FILE);
  fs2.chmodSync(DB_FILE, 384);
  sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, value TEXT NOT NULL);");
  sqlite.prepare("INSERT OR IGNORE INTO state(id,revision,value) VALUES(1,0,?)").run(JSON.stringify(defaults()));
}
async function loadDb() {
  if (rtdb) {
    const snap = await firebaseOperation(() => rtdb.once("value"), "read");
    const raw = snap.val();
    if (raw === null) {
      const p = process.env.ADMIN_PASSWORD?.trim();
      if (!p) throw new Error("ADMIN_PASSWORD is required when initializing an empty database");
      dbData = defaults();
      dbData.admin = { username: process.env.ADMIN_USERNAME?.trim() || "admin", password_hash: await bcrypt.hash(p, 12) };
      revision = 0;
      await saveDb();
      return;
    }
    if (!Number.isSafeInteger(raw.revision) || raw.revision < 1) throw new Error("Configured Firebase data has no valid numeric revision; refusing incompatible schema.");
    revision = raw.revision;
    const normalized = { ...raw };
    for (const field of ["resellers", "prices", "keys", "sessions", "balance_logs"]) if (normalized[field] === void 0 || normalized[field] === null) normalized[field] = [];
    dbData = validateState(normalized);
    return;
  }
  const row = sqlite.prepare("SELECT revision,value FROM state WHERE id=1").get();
  if (!row) throw new Error("SQLite state row missing");
  revision = Number(row.revision);
  const parsed = JSON.parse(row.value);
  if (!parsed.admin?.password_hash) {
    if (revision !== 0 || JSON.stringify(parsed) !== JSON.stringify(defaults())) throw new Error("Incompatible nonempty SQLite schema; refusing initialization");
    const p = process.env.ADMIN_PASSWORD?.trim();
    if (!p) throw new Error("ADMIN_PASSWORD is required when initializing an empty database");
    const seeded = defaults();
    seeded.admin = { username: process.env.ADMIN_USERNAME?.trim() || "admin", password_hash: await bcrypt.hash(p, 12) };
    dbData = seeded;
    await saveDb();
  } else dbData = validateState(parsed);
}
async function saveDb() {
  const expected = revision;
  if (rtdb) {
    let conflictSeen = false;
    const result2 = await firebaseOperation(() => rtdb.transaction((current) => {
      if (current === null) {
        if (expected !== 0) {
          conflictSeen = true;
          return;
        }
        return { ...dbData, revision: 1 };
      }
      if (typeof current.revision !== "number" || current.revision !== expected) {
        conflictSeen = true;
        return;
      }
      return { ...dbData, revision: expected + 1 };
    }), "CAS transaction");
    if (conflictSeen || !result2.committed) {
      await loadDb();
      throw conflict();
    }
    revision = expected + 1;
    return;
  }
  const result = sqlite.prepare("UPDATE state SET value=?, revision=revision+1 WHERE id=1 AND revision=?").run(JSON.stringify(dbData), expected);
  if (Number(result.changes) !== 1) {
    await loadDb();
    throw conflict();
  }
  revision = expected + 1;
}
function generateKey() {
  return `SH-${crypto.randomBytes(2).toString("hex").toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}
function alias(body, a, b) {
  const x = body?.[a], y = body?.[b];
  if (x !== void 0 && typeof x !== "string" || y !== void 0 && typeof y !== "string") throw Object.assign(new Error(`${a} and ${b} must be strings`), { status: 400, code: 1001 });
  if (x !== void 0 && y !== void 0 && x !== y) throw Object.assign(new Error(`Conflicting ${a} and ${b}`), { status: 400, code: 1001 });
  const v = x ?? y;
  if (!v || !v.trim() || v.length > 512) throw Object.assign(new Error(`${a} is required`), { status: 400, code: 1001 });
  return v.trim();
}
async function startServer() {
  await initializeStorage();
  await loadDb();
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "32kb" }));
  for (const method of ["get", "post", "delete", "put", "patch"]) {
    const original = app[method].bind(app);
    app[method] = (route, ...handlers) => original(route, ...handlers.map((h) => (req, res, next) => {
      req._activeHandlers = (req._activeHandlers || 0) + 1;
      return Promise.resolve().then(() => h(req, res, next)).catch(next).finally(() => {
        req._activeHandlers--;
        req._releaseRequest?.();
      });
    }));
  }
  let requestQueue = Promise.resolve();
  app.use((req, res, next) => {
    const prior = requestQueue;
    let release;
    requestQueue = new Promise((resolve) => release = resolve);
    prior.then(async () => {
      try {
        await loadDb();
        if (res.destroyed) {
          release();
          return;
        }
        let done = false, ended = false;
        req._releaseRequest = () => {
          if (ended && !done && !(req._activeHandlers > 0)) {
            done = true;
            release();
          }
        };
        const finish = () => {
          ended = true;
          req._releaseRequest();
        };
        res.once("finish", finish);
        res.once("close", finish);
        next();
      } catch (e) {
        release();
        next(e);
      }
    }, (e) => {
      release();
      next(e);
    });
  });
  const webSessions = /* @__PURE__ */ new Map();
  app.get("/api/health", (_req, res) => res.json({ success: true, storage: rtdb ? "firebase" : "sqlite", ready: true }));
  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password required" });
    }
    if (dbData.admin.username === username && await bcrypt.compare(password, dbData.admin.password_hash)) {
      const token = crypto.randomBytes(16).toString("hex");
      webSessions.set(token, { role: "admin", username: dbData.admin.username });
      return res.json({ success: true, role: "admin", token, username: dbData.admin.username });
    }
    const reseller = dbData.resellers.find((r) => r.username === username);
    if (reseller && await bcrypt.compare(password, reseller.password_hash)) {
      if (!reseller.is_active) {
        return res.status(403).json({ success: false, message: "Reseller account is disabled" });
      }
      const token = crypto.randomBytes(16).toString("hex");
      webSessions.set(token, { role: "reseller", username: reseller.username, reseller_id: reseller.id });
      return res.json({ success: true, role: "reseller", token, username: reseller.username, balance: reseller.balance });
    }
    return res.status(401).json({ success: false, message: "Invalid credentials. Check Shadow Cracker credentials." });
  });
  const requireAuth = (role) => {
    return (req, res, next) => {
      const authHeader = req.headers["authorization"] || req.headers["Authorization"];
      const token = authHeader?.replace("Bearer ", "") || req.query.token;
      const session = webSessions.get(token);
      if (!session) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      if (role && session.role !== role && session.role !== "admin") {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
      req.user = session;
      next();
    };
  };
  app.get("/api/admin/data", requireAuth("admin"), async (req, res) => {
    await loadDb();
    const total = dbData.keys.length;
    const used = dbData.keys.filter((k) => k.activated_at).length;
    let totalDevices = 0;
    dbData.keys.forEach((k) => {
      if (k.hwid_list) totalDevices += k.hwid_list.length;
    });
    res.json({
      success: true,
      keys: [...dbData.keys].reverse().slice(0, 100),
      resellers: dbData.resellers.map((r) => ({ id: r.id, username: r.username, balance: r.balance, is_active: r.is_active, created_at: r.created_at, note: r.note })),
      prices: dbData.prices,
      stats: {
        total,
        used,
        unused: total - used,
        totalDevices
      },
      api_url: `${req.protocol}://${req.get("host")}/api/activate`
    });
  });
  app.post("/api/admin/generate", requireAuth("admin"), async (req, res) => {
    const { duration, count = 10, max_devices = 1, note = "" } = req.body;
    const dur = parseInt(duration) || 1;
    const cnt = Math.max(1, Math.min(parseInt(count) || 1, 200));
    const maxDev = Math.max(1, parseInt(max_devices) || 1);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const user = req.user.username;
    for (let i = 0; i < cnt; i++) {
      const newKey = {
        id: dbData.keys.length > 0 ? Math.max(...dbData.keys.map((k) => k.id)) + 1 : 1,
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
  app.post("/api/admin/prices", requireAuth("admin"), async (req, res) => {
    const pricesObj = req.body.prices;
    if (!pricesObj) return res.status(400).json({ success: false, message: "Invalid prices" });
    for (const [days, price] of Object.entries(pricesObj)) {
      const d = parseInt(days);
      const p = parseFloat(price) || 0;
      const existing = dbData.prices.find((item) => item.duration_days === d);
      if (existing) {
        existing.price = p;
      } else {
        dbData.prices.push({ duration_days: d, price: p });
      }
    }
    dbData.prices.sort((a, b) => a.duration_days - b.duration_days);
    await saveDb();
    res.json({ success: true, message: "Prices updated successfully" });
  });
  app.post("/api/admin/reseller/create", requireAuth("admin"), async (req, res) => {
    const { username, password, balance = 100, note = "" } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password required" });
    }
    if (dbData.resellers.some((r) => r.username === username)) {
      return res.status(400).json({ success: false, message: "Reseller username already exists" });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const newRes = {
      id: dbData.resellers.length > 0 ? Math.max(...dbData.resellers.map((r) => r.id)) + 1 : 1,
      username,
      password_hash,
      balance: parseFloat(balance) || 0,
      is_active: 1,
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      note
    };
    dbData.resellers.push(newRes);
    await saveDb();
    res.json({ success: true, message: "Reseller created successfully" });
  });
  app.post("/api/admin/reseller/balance", requireAuth("admin"), async (req, res) => {
    const { reseller_id, amount, reason = "Admin adjustment" } = req.body;
    const amt = parseFloat(amount);
    if (isNaN(amt)) return res.status(400).json({ success: false, message: "Invalid amount" });
    const reseller = dbData.resellers.find((r) => r.id === Number(reseller_id));
    if (!reseller) return res.status(404).json({ success: false, message: "Reseller not found" });
    reseller.balance += amt;
    dbData.balance_logs.push({
      id: dbData.balance_logs.length > 0 ? Math.max(...dbData.balance_logs.map((l) => l.id)) + 1 : 1,
      reseller_id: reseller.id,
      amount: amt,
      reason,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    await saveDb();
    res.json({ success: true, message: "Balance updated successfully" });
  });
  app.post("/api/admin/reseller/toggle/:id", requireAuth("admin"), async (req, res) => {
    const id = Number(req.params.id);
    const reseller = dbData.resellers.find((r) => r.id === id);
    if (!reseller) return res.status(404).json({ success: false, message: "Reseller not found" });
    reseller.is_active = reseller.is_active ? 0 : 1;
    await saveDb();
    res.json({ success: true, is_active: reseller.is_active });
  });
  const deleteKeyHandler = async (req, res) => {
    const id = Number(req.params.id);
    const key = dbData.keys.find((k) => k.id === id);
    if (key) {
      dbData.sessions = dbData.sessions.filter((s) => s.key_value !== key.key_value);
    }
    dbData.keys = dbData.keys.filter((k) => k.id !== id);
    await saveDb();
    res.json({ success: true, message: "Key deleted successfully" });
  };
  app.delete("/api/admin/key/:id", requireAuth("admin"), deleteKeyHandler);
  app.post("/api/admin/key/delete/:id", requireAuth("admin"), deleteKeyHandler);
  app.post("/api/admin/keys/batch-delete", requireAuth("admin"), async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ success: false, message: "Invalid IDs" });
    const keysToDelete = dbData.keys.filter((k) => ids.includes(k.id));
    const vals = keysToDelete.map((k) => k.key_value);
    dbData.sessions = dbData.sessions.filter((s) => !vals.includes(s.key_value));
    dbData.keys = dbData.keys.filter((k) => !ids.includes(k.id));
    await saveDb();
    res.json({ success: true, message: `Deleted ${ids.length} keys successfully` });
  });
  app.post("/api/admin/keys/batch-reset", requireAuth("admin"), async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ success: false, message: "Invalid IDs" });
    const vals = [];
    dbData.keys.forEach((k) => {
      if (ids.includes(k.id)) {
        k.hwid_list = [];
        vals.push(k.key_value);
      }
    });
    dbData.sessions = dbData.sessions.filter((s) => !vals.includes(s.key_value));
    await saveDb();
    res.json({ success: true, message: `Reset devices & revoked sessions for ${ids.length} keys` });
  });
  app.post("/api/admin/keys/batch-status", requireAuth("admin"), async (req, res) => {
    const { ids, is_disabled } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ success: false, message: "Invalid IDs" });
    const vals = [];
    dbData.keys.forEach((k) => {
      if (ids.includes(k.id)) {
        k.is_disabled = is_disabled ? 1 : 0;
        if (is_disabled) vals.push(k.key_value);
      }
    });
    if (is_disabled) {
      dbData.sessions = dbData.sessions.filter((s) => !vals.includes(s.key_value));
    }
    await saveDb();
    res.json({ success: true, message: `Updated status for ${ids.length} keys` });
  });
  app.post("/api/admin/key/reset-devices/:id", requireAuth("admin"), async (req, res) => {
    const id = Number(req.params.id);
    const key = dbData.keys.find((k) => k.id === id);
    if (!key) return res.status(404).json({ success: false, message: "Key not found" });
    key.hwid_list = [];
    dbData.sessions = dbData.sessions.filter((s) => s.key_value !== key.key_value);
    await saveDb();
    res.json({ success: true, message: "Device bindings reset and sessions revoked successfully (Expiration preserved)" });
  });
  app.post("/api/admin/key/toggle-disable/:id", requireAuth("admin"), async (req, res) => {
    const id = Number(req.params.id);
    const key = dbData.keys.find((k) => k.id === id);
    if (!key) return res.status(404).json({ success: false, message: "Key not found" });
    key.is_disabled = key.is_disabled ? 0 : 1;
    if (key.is_disabled) {
      dbData.sessions = dbData.sessions.filter((s) => s.key_value !== key.key_value);
    }
    await saveDb();
    res.json({ success: true, is_disabled: key.is_disabled });
  });
  app.get("/api/reseller/data", requireAuth("reseller"), async (req, res) => {
    await loadDb();
    const rid = req.user.reseller_id;
    const reseller = dbData.resellers.find((r) => r.id === rid);
    const keys = dbData.keys.filter((k) => k.reseller_id === rid).reverse();
    const logs = dbData.balance_logs.filter((l) => l.reseller_id === rid).reverse();
    res.json({
      success: true,
      reseller: reseller ? { id: reseller.id, username: reseller.username, balance: reseller.balance, is_active: reseller.is_active } : null,
      keys,
      prices: dbData.prices,
      logs
    });
  });
  app.post("/api/reseller/generate", requireAuth("reseller"), async (req, res) => {
    const rid = req.user.reseller_id;
    const duration = parseInt(req.body.duration) || 1;
    const count = Math.max(1, Math.min(parseInt(req.body.count) || 1, 50));
    const maxDev = Math.max(1, parseInt(req.body.max_devices) || 1);
    const priceRow = dbData.prices.find((p) => p.duration_days === duration);
    if (!priceRow) return res.status(400).json({ success: false, message: "Invalid duration" });
    const totalCost = priceRow.price * count;
    const reseller = dbData.resellers.find((r) => r.id === rid);
    if (!reseller || reseller.balance < totalCost) {
      return res.status(400).json({ success: false, message: `Insufficient balance. Need $${totalCost}, have $${reseller?.balance || 0}` });
    }
    reseller.balance -= totalCost;
    dbData.balance_logs.push({
      id: dbData.balance_logs.length > 0 ? Math.max(...dbData.balance_logs.map((l) => l.id)) + 1 : 1,
      reseller_id: rid,
      amount: -totalCost,
      reason: `Generated ${count}x${duration}d keys`,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    const now = (/* @__PURE__ */ new Date()).toISOString();
    for (let i = 0; i < count; i++) {
      dbData.keys.push({
        id: dbData.keys.length > 0 ? Math.max(...dbData.keys.map((k) => k.id)) + 1 : 1,
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
  app.post("/api/activate", async (req, res) => {
    await loadDb();
    const targetKey = alias(req.body, "license_key", "key");
    const hwid = alias(req.body, "device_fingerprint", "hwid");
    if (!targetKey) {
      return res.status(400).json({
        success: false,
        error_code: 1001,
        message: 'License key is required ("license_key" or "key")',
        session_id: null
      });
    }
    if (!hwid) {
      return res.status(400).json({
        success: false,
        error_code: 1005,
        message: "HWID is required for device binding",
        session_id: null
      });
    }
    const kRow = dbData.keys.find((k) => k.key_value === targetKey);
    if (!kRow) {
      return res.status(404).json({
        success: false,
        error_code: 1002,
        message: "Invalid license key",
        session_id: null
      });
    }
    if (kRow.is_disabled) {
      return res.status(403).json({
        success: false,
        error_code: 1003,
        message: "License key has been disabled by admin",
        session_id: null
      });
    }
    if (!kRow.hwid_list) kRow.hwid_list = [];
    if (!kRow.max_devices) kRow.max_devices = 1;
    const now = /* @__PURE__ */ new Date();
    if (!Array.isArray(kRow.hwid_list) || !Number.isSafeInteger(kRow.max_devices) || kRow.max_devices < 1 || !Number.isFinite(kRow.duration_days) || kRow.duration_days <= 0 || Boolean(kRow.activated_at) !== Boolean(kRow.expires_at)) throw Object.assign(new Error("Stored license state is corrupt"), { status: 500, code: 1501 });
    if (!kRow.activated_at && !kRow.hwid_list.includes(hwid) && kRow.hwid_list.length >= kRow.max_devices) return res.status(403).json({ success: false, error_code: 1006, message: "Device limit reached", session_id: null });
    if (kRow.activated_at && kRow.expires_at) {
      const expDate = new Date(kRow.expires_at);
      if (!Number.isFinite(expDate.getTime())) throw Object.assign(new Error("Stored license expiration is corrupt"), { status: 500, code: 1501 });
      if (!Number.isFinite(expDate.getTime()) || now.getTime() >= expDate.getTime()) {
        return res.status(400).json({
          success: false,
          error_code: 1004,
          message: "License key has expired",
          session_id: null
        });
      }
      if (!kRow.hwid_list.includes(hwid)) {
        if (kRow.hwid_list.length >= kRow.max_devices) {
          return res.status(403).json({
            success: false,
            error_code: 1006,
            message: `Device limit reached (${kRow.hwid_list.length}/${kRow.max_devices})`,
            session_id: null
          });
        }
        kRow.hwid_list.push(hwid);
      }
      const sessionId2 = crypto.randomBytes(16).toString("hex");
      const sessionExpires2 = new Date(Math.min(expDate.getTime(), now.getTime() + Math.max(1, Number(process.env.SESSION_TTL_SECONDS) || 3600) * 1e3)).toISOString();
      dbData.sessions.push({
        session_id: sessionId2,
        key_value: targetKey,
        hwid,
        created_at: now.toISOString(),
        last_heartbeat: now.toISOString(),
        expires_at: sessionExpires2
      });
      await saveDb();
      return res.json({
        success: true,
        error_code: 0,
        message: "License validated successfully",
        session_id: sessionId2,
        expires_at: kRow.expires_at,
        plan: `${kRow.duration_days} Days`,
        session_expires_at: sessionExpires2,
        heartbeat_interval: 60,
        user: {
          expires_at: kRow.expires_at
        },
        seller: {
          name: "Shadow Cracker"
        }
      });
    }
    const activatedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + kRow.duration_days * 24 * 60 * 60 * 1e3).toISOString();
    const sessionId = crypto.randomBytes(16).toString("hex");
    const sessionExpires = new Date(Math.min(new Date(expiresAt).getTime(), now.getTime() + Math.max(1, Number(process.env.SESSION_TTL_SECONDS) || 3600) * 1e3)).toISOString();
    kRow.activated_at = activatedAt;
    kRow.expires_at = expiresAt;
    kRow.hwid_list.push(hwid);
    dbData.sessions.push({
      session_id: sessionId,
      key_value: targetKey,
      hwid,
      created_at: now.toISOString(),
      last_heartbeat: now.toISOString(),
      expires_at: sessionExpires
    });
    await saveDb();
    return res.json({
      success: true,
      error_code: 0,
      message: "License activated successfully",
      session_id: sessionId,
      expires_at: expiresAt,
      plan: `${kRow.duration_days} Days`,
      session_expires_at: sessionExpires,
      heartbeat_interval: 60,
      user: {
        expires_at: expiresAt
      },
      seller: {
        name: "Shadow Cracker"
      }
    });
  });
  app.post("/api/heartbeat", async (req, res) => {
    await loadDb();
    const targetKey = alias(req.body, "license_key", "key");
    const hwid = alias(req.body, "device_fingerprint", "hwid");
    const session_id = typeof req.body?.session_id === "string" ? req.body.session_id : (() => {
      throw Object.assign(new Error("session_id is required"), { status: 400, code: 2001 });
    })();
    if (!targetKey || !session_id || !hwid) {
      return res.status(400).json({
        success: false,
        error_code: 2001,
        message: "license_key, session_id, and hwid are required for heartbeat"
      });
    }
    const session = dbData.sessions.find((s) => s.session_id === session_id && s.key_value === targetKey);
    if (!session || session.revoked) {
      return res.status(401).json({
        success: false,
        error_code: 2002,
        message: "Invalid, revoked, or expired session ID"
      });
    }
    if (session.hwid !== hwid) {
      return res.status(403).json({
        success: false,
        error_code: 2005,
        message: "HWID mismatch on heartbeat"
      });
    }
    const now = /* @__PURE__ */ new Date();
    if (!Number.isFinite(Date.parse(session.expires_at)) || now.getTime() >= Date.parse(session.expires_at)) {
      return res.status(401).json({
        success: false,
        error_code: 2006,
        message: "Session has expired"
      });
    }
    const kRow = dbData.keys.find((k) => k.key_value === targetKey);
    if (!kRow || kRow.is_disabled) {
      return res.status(403).json({
        success: false,
        error_code: 2003,
        message: "License key is invalid or disabled"
      });
    }
    if (!kRow.activated_at || !kRow.expires_at) return res.status(403).json({ success: false, error_code: 2003, message: "License activation state is invalid" });
    if (kRow.expires_at && (!Number.isFinite(Date.parse(kRow.expires_at)) || now.getTime() >= Date.parse(kRow.expires_at))) {
      return res.status(400).json({
        success: false,
        error_code: 2004,
        message: "License has expired"
      });
    }
    if (!kRow.hwid_list || !kRow.hwid_list.includes(hwid)) {
      return res.status(403).json({
        success: false,
        error_code: 2007,
        message: "Device binding revoked or reset"
      });
    }
    session.last_heartbeat = now.toISOString();
    await saveDb();
    return res.json({
      success: true,
      error_code: 0,
      message: "Heartbeat OK",
      session_id: session.session_id,
      expires_at: kRow.expires_at,
      plan: `${kRow.duration_days} Days`,
      session_expires_at: session.expires_at,
      heartbeat_interval: 60,
      user: {
        expires_at: kRow.expires_at
      },
      seller: {
        name: "Shadow Cracker"
      }
    });
  });
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error("Request failed; private details omitted");
    return res.status(status).json({ success: false, error_code: Number(err?.code) || 1500, message: err?.type === "entity.parse.failed" ? "Malformed JSON" : status < 500 ? err?.message || "Request failed" : "Internal server error" });
  });
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path2.join(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path2.join(__dirname, "dist", "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }
  const port = typeof process.env.PORT === "string" ? parseInt(process.env.PORT, 10) : process.env.PORT || 3e3;
  app.listen(port, process.env.HOST || "127.0.0.1", () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}
void startServer().catch((error) => {
  console.error("Startup failed:", error.message);
  process.exit(1);
});
