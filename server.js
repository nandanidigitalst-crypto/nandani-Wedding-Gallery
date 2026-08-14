const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(ROOT, "storage");
const DATA = path.join(STORAGE_ROOT, "data");
const UPLOADS = path.join(STORAGE_ROOT, "uploads");
const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024;
const CHUNK_BYTES = 8 * 1024 * 1024;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = "nandani_session";

for (const dir of [DATA, UPLOADS, path.join(DATA, "tmp")]) fs.mkdirSync(dir, { recursive: true });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(ROOT, "public")));

const upload = multer({
  dest: path.join(DATA, "tmp"),
  limits: { fileSize: CHUNK_BYTES + 1024 * 1024 }
});
const dbFile = path.join(DATA, "gallery.json");

function readDB() {
  try {
    const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
    db.weddings ||= [];
    db.sessions ||= [];
    return db;
  } catch {
    return { weddings: [], sessions: [] };
  }
}
function writeDB(db) {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}
function safeName(name) {
  return String(name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 180);
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function createSession(role, weddingId = null) {
  const token = crypto.randomBytes(32).toString("hex");
  const db = readDB();
  db.sessions = db.sessions.filter(s => s.expiresAt > Date.now());
  db.sessions.push({
    tokenHash: tokenHash(token),
    role,
    weddingId,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  writeDB(db);
  return token;
}
function currentSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const db = readDB();
  const session = db.sessions.find(s => s.tokenHash === tokenHash(token) && s.expiresAt > Date.now());
  return session || null;
}
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
function requireAdmin(req, res, next) {
  const session = currentSession(req);
  if (!session || session.role !== "admin") return res.status(401).json({ error: "Admin login required." });
  req.session = session;
  next();
}
function requireCustomer(req, res, next) {
  const session = currentSession(req);
  if (!session || session.role !== "customer" || !session.weddingId) {
    return res.status(401).json({ error: "Customer login required." });
  }
  req.session = session;
  next();
}
function requireAnyAuth(req, res, next) {
  const session = currentSession(req);
  if (!session) return res.status(401).json({ error: "Login required." });
  req.session = session;
  next();
}
function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(secret), salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}
function verifySecret(secret, stored) {
  try {
    const [saltHex, hashHex] = String(stored).split(":");
    if (!saltHex || !hashHex) return false;
    const derived = crypto.scryptSync(String(secret), Buffer.from(saltHex, "hex"), 64);
    return crypto.timingSafeEqual(derived, Buffer.from(hashHex, "hex"));
  } catch {
    return false;
  }
}
function adminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD_HASH);
}
function adminUsername() {
  return process.env.ADMIN_USERNAME || "admin";
}
function makeLoginId() {
  const db = readDB();
  let id;
  do {
    id = `WED-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  } while (db.weddings.some(w => w.loginId === id));
  return id;
}
function findWeddingForFile(fileId) {
  const db = readDB();
  for (const wedding of db.weddings) {
    const file = wedding.files.find(f => f.id === fileId);
    if (file) return { db, wedding, file };
  }
  return null;
}

app.get("/api/config", (req, res) => {
  res.json({ maxFileBytes: MAX_FILE_BYTES, chunkBytes: CHUNK_BYTES, adminConfigured: adminConfigured() });
});

app.get("/api/auth/me", (req, res) => {
  const session = currentSession(req);
  if (!session) return res.json({ authenticated: false });
  const db = readDB();
  if (session.role === "admin") {
    return res.json({ authenticated: true, role: "admin", username: adminUsername() });
  }
  const wedding = db.weddings.find(w => w.id === session.weddingId);
  if (!wedding) return res.json({ authenticated: false });
  res.json({
    authenticated: true,
    role: "customer",
    wedding: {
      id: wedding.id,
      loginId: wedding.loginId,
      name: wedding.name,
      customerName: wedding.customerName
    }
  });
});

app.post("/api/auth/admin/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!adminConfigured()) return res.status(503).json({ error: "Admin password is not configured. Set ADMIN_PASSWORD on the server." });
  if (username !== adminUsername()) return res.status(401).json({ error: "Invalid admin username or password." });
  const hashOk = process.env.ADMIN_PASSWORD_HASH && verifySecret(password, process.env.ADMIN_PASSWORD_HASH);
  const plainOk = process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD;
  if (!hashOk && !plainOk) return res.status(401).json({ error: "Invalid admin username or password." });
  const token = createSession("admin");
  setSessionCookie(res, token);
  res.json({ ok: true, role: "admin" });
});

app.post("/api/auth/customer/login", (req, res) => {
  const loginId = String(req.body.loginId || "").trim().toUpperCase();
  const accessCode = String(req.body.accessCode || "").trim();
  const db = readDB();
  const wedding = db.weddings.find(w => w.loginId === loginId && w.accessCodeHash);
  if (!wedding || !verifySecret(accessCode, wedding.accessCodeHash)) {
    return res.status(401).json({ error: "Invalid Wedding ID or Access Code." });
  }
  const token = createSession("customer", wedding.id);
  setSessionCookie(res, token);
  res.json({
    ok: true,
    role: "customer",
    wedding: { id: wedding.id, loginId: wedding.loginId, name: wedding.name, customerName: wedding.customerName }
  });
});

app.post("/api/auth/logout", (req, res) => {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) {
    const db = readDB();
    db.sessions = db.sessions.filter(s => s.tokenHash !== tokenHash(token));
    writeDB(db);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Admin-only wedding/customer management.
app.get("/api/admin/weddings", requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.weddings.map(w => ({
    id: w.id,
    loginId: w.loginId,
    name: w.name,
    customerName: w.customerName || "",
    customerMobile: w.customerMobile || "",
    customerEmail: w.customerEmail || "",
    price: w.price || 0,
    paymentStatus: w.paymentStatus || "unpaid",
    createdAt: w.createdAt,
    filesCount: w.files.length
  })));
});

app.post("/api/admin/weddings", requireAdmin, (req, res) => {
  const name = String(req.body.name || "").trim();
  const customerName = String(req.body.customerName || "").trim();
  const customerMobile = String(req.body.customerMobile || "").trim();
  const customerEmail = String(req.body.customerEmail || "").trim();
  const price = Math.max(0, Number(req.body.price || 0));
  const accessCode = String(req.body.accessCode || "").trim();

  if (!name || !customerName || !accessCode) {
    return res.status(400).json({ error: "Wedding name, customer name and access code are required." });
  }
  if (accessCode.length < 4) return res.status(400).json({ error: "Access code must be at least 4 characters." });

  const db = readDB();
  const wedding = {
    id: crypto.randomUUID(),
    loginId: makeLoginId(),
    name,
    customerName,
    customerMobile,
    customerEmail,
    price,
    paymentStatus: "unpaid",
    accessCodeHash: hashSecret(accessCode),
    createdAt: new Date().toISOString(),
    files: []
  };
  db.weddings.unshift(wedding);
  writeDB(db);
  res.json({
    id: wedding.id,
    loginId: wedding.loginId,
    name: wedding.name,
    customerName: wedding.customerName,
    customerMobile: wedding.customerMobile,
    customerEmail: wedding.customerEmail,
    price: wedding.price,
    paymentStatus: wedding.paymentStatus,
    accessCode
  });
});

app.patch("/api/admin/weddings/:id", requireAdmin, (req, res) => {
  const db = readDB();
  const wedding = db.weddings.find(w => w.id === req.params.id);
  if (!wedding) return res.status(404).json({ error: "Wedding not found." });
  if (req.body.name !== undefined) wedding.name = String(req.body.name).trim();
  if (req.body.customerName !== undefined) wedding.customerName = String(req.body.customerName).trim();
  if (req.body.customerMobile !== undefined) wedding.customerMobile = String(req.body.customerMobile).trim();
  if (req.body.customerEmail !== undefined) wedding.customerEmail = String(req.body.customerEmail).trim();
  if (req.body.price !== undefined) wedding.price = Math.max(0, Number(req.body.price || 0));
  if (req.body.paymentStatus !== undefined) {
    const status = String(req.body.paymentStatus);
    if (!["unpaid", "paid"].includes(status)) return res.status(400).json({ error: "Invalid payment status." });
    wedding.paymentStatus = status;
  }
  if (req.body.accessCode) wedding.accessCodeHash = hashSecret(String(req.body.accessCode));
  writeDB(db);
  res.json({ ok: true });
});

app.delete("/api/admin/weddings/:id", requireAdmin, (req, res) => {
  const db = readDB();
  const idx = db.weddings.findIndex(w => w.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Wedding not found." });
  const wedding = db.weddings[idx];
  for (const item of wedding.files) {
    const stored = path.basename(decodeURIComponent(item.url.replace("/media/", "")));
    const full = path.join(UPLOADS, stored);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
  db.weddings.splice(idx, 1);
  writeDB(db);
  res.json({ ok: true });
});

// Backward-compatible API is now admin-protected.
app.get("/api/weddings", requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.weddings.map(w => ({ ...w, accessCodeHash: undefined })));
});

app.post("/api/weddings", requireAdmin, (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Wedding name is required." });
  const db = readDB();
  const wedding = {
    id: crypto.randomUUID(),
    loginId: makeLoginId(),
    name,
    customerName: "",
    price: 0,
    paymentStatus: "unpaid",
    accessCodeHash: hashSecret(crypto.randomBytes(6).toString("hex")),
    createdAt: new Date().toISOString(),
    files: []
  };
  db.weddings.unshift(wedding);
  writeDB(db);
  res.json({ id: wedding.id, loginId: wedding.loginId, name: wedding.name, createdAt: wedding.createdAt, files: [] });
});

app.get("/api/weddings/:id/files", requireAnyAuth, (req, res) => {
  const db = readDB();
  const wedding = db.weddings.find(w => w.id === req.params.id);
  if (!wedding) return res.status(404).json({ error: "Wedding not found." });
  if (req.session.role === "customer" && req.session.weddingId !== wedding.id) {
    return res.status(403).json({ error: "You do not have access to this wedding." });
  }
  res.json(wedding.files);
});

app.post("/api/upload/start", requireAdmin, (req, res) => {
  const { weddingId, fileName, size, mime } = req.body;
  if (!weddingId || !fileName || !Number.isFinite(Number(size))) {
    return res.status(400).json({ error: "weddingId, fileName and size are required." });
  }
  const fileSize = Number(size);
  if (fileSize > MAX_FILE_BYTES) return res.status(413).json({ error: "File is larger than 20 GB." });

  const db = readDB();
  const wedding = db.weddings.find(w => w.id === weddingId);
  if (!wedding) return res.status(404).json({ error: "Wedding not found." });

  const id = crypto.randomUUID();
  const tempPath = path.join(DATA, `${id}.part`);
  fs.closeSync(fs.openSync(tempPath, "w"));
  const meta = {
    id, weddingId, fileName: safeName(fileName), size: fileSize, mime: mime || "application/octet-stream",
    received: 0, tempPath, createdAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(DATA, `${id}.json`), JSON.stringify(meta));
  res.json({ uploadId: id, chunkBytes: CHUNK_BYTES });
});

app.post("/api/upload/:id/chunk", requireAdmin, upload.single("chunk"), (req, res) => {
  const metaPath = path.join(DATA, `${req.params.id}.json`);
  if (!fs.existsSync(metaPath)) return res.status(404).json({ error: "Upload session not found." });
  if (!req.file) return res.status(400).json({ error: "Chunk is missing." });
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const start = Number(req.headers["x-chunk-start"] || meta.received);
  if (start !== meta.received) {
    fs.unlinkSync(req.file.path);
    return res.status(409).json({ error: "Wrong chunk position.", received: meta.received });
  }
  const chunkSize = req.file.size;
  if (meta.received + chunkSize > meta.size) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Chunk exceeds file size." });
  }
  const chunk = fs.readFileSync(req.file.path);
  fs.appendFileSync(meta.tempPath, chunk);
  fs.unlinkSync(req.file.path);
  meta.received += chunkSize;
  fs.writeFileSync(metaPath, JSON.stringify(meta));
  res.json({ received: meta.received, total: meta.size, complete: meta.received === meta.size });
});

app.post("/api/upload/:id/finish", requireAdmin, (req, res) => {
  const metaPath = path.join(DATA, `${req.params.id}.json`);
  if (!fs.existsSync(metaPath)) return res.status(404).json({ error: "Upload session not found." });
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  if (meta.received !== meta.size) return res.status(400).json({ error: "Upload is incomplete.", received: meta.received });
  const ext = path.extname(meta.fileName);
  const stored = `${meta.id}${ext}`;
  const finalPath = path.join(UPLOADS, stored);
  fs.renameSync(meta.tempPath, finalPath);

  const db = readDB();
  const wedding = db.weddings.find(w => w.id === meta.weddingId);
  if (!wedding) return res.status(404).json({ error: "Wedding not found." });
  const item = {
    id: meta.id, name: meta.fileName, mime: meta.mime, size: meta.size,
    url: `/media/${encodeURIComponent(stored)}`, uploadedAt: new Date().toISOString()
  };
  wedding.files.unshift(item);
  writeDB(db);
  fs.unlinkSync(metaPath);
  res.json(item);
});

app.get("/media/:file", requireAnyAuth, (req, res) => {
  const file = path.basename(decodeURIComponent(req.params.file));
  const db = readDB();
  let owner = null;
  let item = null;
  for (const wedding of db.weddings) {
    const candidate = wedding.files.find(f => path.basename(decodeURIComponent(f.url.replace("/media/", ""))) === file);
    if (candidate) { owner = wedding; item = candidate; break; }
  }
  if (!owner || !item) return res.status(404).end();
  if (req.session.role === "customer" && req.session.weddingId !== owner.id) return res.status(403).end();
  const full = path.join(UPLOADS, file);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});

app.delete("/api/weddings/:weddingId/files/:fileId", requireAdmin, (req, res) => {
  const db = readDB();
  const wedding = db.weddings.find(w => w.id === req.params.weddingId);
  if (!wedding) return res.status(404).json({ error: "Wedding not found." });
  const idx = wedding.files.findIndex(f => f.id === req.params.fileId);
  if (idx < 0) return res.status(404).json({ error: "File not found." });
  const item = wedding.files[idx];
  const stored = path.basename(decodeURIComponent(item.url.replace("/media/", "")));
  const full = path.join(UPLOADS, stored);
  if (fs.existsSync(full)) fs.unlinkSync(full);
  wedding.files.splice(idx, 1);
  writeDB(db);
  res.json({ ok: true });
});

app.get("/api/health", (req, res) => res.json({ ok: true, service: "Nandani Wedding Gallery" }));

app.listen(PORT, "0.0.0.0", () => console.log(`Nandani Wedding Gallery running on port ${PORT}`));
