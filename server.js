const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
// Railway Volume can be mounted at /app/storage.
// Locally, the app continues to use ./storage.
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(ROOT, "storage");
const DATA = path.join(STORAGE_ROOT, "data");
const UPLOADS = path.join(STORAGE_ROOT, "uploads");
const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB
const CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB

for (const dir of [DATA, UPLOADS, path.join(DATA, "tmp")]) fs.mkdirSync(dir, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(ROOT, "public")));

const upload = multer({
  dest: path.join(DATA, "tmp"),
  limits: { fileSize: CHUNK_BYTES + 1024 * 1024 }
});
const dbFile = path.join(DATA, "gallery.json");
function readDB() {
  try { return JSON.parse(fs.readFileSync(dbFile, "utf8")); }
  catch { return { weddings: [] }; }
}
function writeDB(db) {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}
function safeName(name) {
  return String(name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 180);
}

app.get("/api/config", (req, res) => {
  res.json({ maxFileBytes: MAX_FILE_BYTES, chunkBytes: CHUNK_BYTES });
});

app.get("/api/weddings", (req, res) => {
  res.json(readDB().weddings);
});

app.post("/api/weddings", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Wedding name is required." });
  const db = readDB();
  const wedding = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), files: [] };
  db.weddings.unshift(wedding);
  writeDB(db);
  res.json(wedding);
});

app.get("/api/weddings/:id/files", (req, res) => {
  const db = readDB();
  const wedding = db.weddings.find(w => w.id === req.params.id);
  if (!wedding) return res.status(404).json({ error: "Wedding not found." });
  res.json(wedding.files);
});

app.post("/api/upload/start", (req, res) => {
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

app.post("/api/upload/:id/chunk", upload.single("chunk"), (req, res) => {
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

app.post("/api/upload/:id/finish", (req, res) => {
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
  const item = {
    id: meta.id, name: meta.fileName, mime: meta.mime, size: meta.size,
    url: `/media/${encodeURIComponent(stored)}`, uploadedAt: new Date().toISOString()
  };
  wedding.files.unshift(item);
  writeDB(db);
  fs.unlinkSync(metaPath);
  res.json(item);
});

app.get("/media/:file", (req, res) => {
  const file = path.basename(decodeURIComponent(req.params.file));
  const full = path.join(UPLOADS, file);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});

app.delete("/api/weddings/:weddingId/files/:fileId", (req, res) => {
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
