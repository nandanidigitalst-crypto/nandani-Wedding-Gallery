const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const Razorpay = require("razorpay");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(ROOT, "storage");
const DATA = path.join(STORAGE_ROOT, "data");
const UPLOADS = path.join(STORAGE_ROOT, "uploads");
const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024;
const CHUNK_BYTES = 8 * 1024 * 1024;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me-now";
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const razorpay = RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET ? new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET }) : null;

for (const dir of [DATA, UPLOADS, path.join(DATA, "tmp")]) fs.mkdirSync(dir, { recursive: true });
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(ROOT, "public")));
const upload = multer({ dest: path.join(DATA, "tmp"), limits: { fileSize: CHUNK_BYTES + 1024 * 1024 } });
const dbFile = path.join(DATA, "gallery.json");
function readDB() { try { return JSON.parse(fs.readFileSync(dbFile, "utf8")); } catch { return { weddings: [], payments: [] }; } }
function writeDB(db) { fs.writeFileSync(dbFile, JSON.stringify(db, null, 2)); }
function safeName(name) { return String(name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 180); }
function tokenFor(w) { return crypto.createHmac("sha256", ADMIN_PASSWORD).update(w.id + ":" + w.accessCode).digest("hex"); }
function adminOk(req) { return req.headers.authorization === "Bearer " + crypto.createHash("sha256").update(ADMIN_PASSWORD).digest("hex"); }
function publicWedding(w) { return { id:w.id,name:w.name,createdAt:w.createdAt,files:w.files||[],price:w.price||0,paid:!!w.paid,customerName:w.customerName||"",customerEmail:w.customerEmail||"",customerPhone:w.customerPhone||"",accessCode:w.accessCode }; }
function customerFrom(req) {
  const { weddingId, accessCode } = req.body || req.query || {};
  if (!weddingId || !accessCode) return null;
  const db=readDB(); const w=db.weddings.find(x=>x.id===weddingId && x.accessCode===accessCode); return w||null;
}

app.get("/api/config", (req,res)=>res.json({maxFileBytes:MAX_FILE_BYTES,chunkBytes:CHUNK_BYTES,razorpayEnabled:!!razorpay,razorpayKeyId:RAZORPAY_KEY_ID}));
app.post("/api/admin/login", (req,res)=>{ if(String(req.body.password||"")!==ADMIN_PASSWORD)return res.status(401).json({error:"Invalid admin password"}); res.json({token:crypto.createHash("sha256").update(ADMIN_PASSWORD).digest("hex")}); });
app.get("/api/admin/weddings",(req,res)=>{if(!adminOk(req))return res.status(401).json({error:"Admin login required"});res.json(readDB().weddings.map(publicWedding));});
app.post("/api/admin/weddings",(req,res)=>{if(!adminOk(req))return res.status(401).json({error:"Admin login required"});const name=String(req.body.name||"").trim();if(!name)return res.status(400).json({error:"Wedding name is required."});const db=readDB();const w={id:crypto.randomUUID(),name,customerName:String(req.body.customerName||""),customerEmail:String(req.body.customerEmail||""),customerPhone:String(req.body.customerPhone||""),price:Math.max(0,Number(req.body.price)||0),paid:false,accessCode:crypto.randomBytes(5).toString("hex").toUpperCase(),createdAt:new Date().toISOString(),files:[]};db.weddings.unshift(w);writeDB(db);res.json(publicWedding(w));});
app.patch("/api/admin/weddings/:id",(req,res)=>{if(!adminOk(req))return res.status(401).json({error:"Admin login required"});const db=readDB(),w=db.weddings.find(x=>x.id===req.params.id);if(!w)return res.status(404).json({error:"Wedding not found"});for(const k of ["name","customerName","customerEmail","customerPhone"])if(req.body[k]!==undefined)w[k]=String(req.body[k]);if(req.body.price!==undefined)w.price=Math.max(0,Number(req.body.price)||0);writeDB(db);res.json(publicWedding(w));});
app.delete("/api/admin/weddings/:id",(req,res)=>{if(!adminOk(req))return res.status(401).json({error:"Admin login required"});const db=readDB(),i=db.weddings.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Wedding not found"});db.weddings.splice(i,1);writeDB(db);res.json({ok:true});});

app.get("/api/customer/session",(req,res)=>{const w=customerFrom(req);if(!w)return res.status(401).json({error:"Invalid wedding ID or access code"});res.json(publicWedding(w));});

app.post("/api/payments/order",async(req,res)=>{try{const w=customerFrom(req);if(!w)return res.status(401).json({error:"Invalid customer access"});if(w.paid)return res.json({paid:true});if(!razorpay)return res.status(503).json({error:"Payment gateway is not configured on server yet."});const amount=Math.round(Number(w.price)*100);if(amount<=0)return res.status(400).json({error:"This wedding has no payment amount."});const order=await razorpay.orders.create({amount,currency:"INR",receipt:`wedding_${w.id.slice(0,20)}`,notes:{weddingId:w.id}});const db=readDB();db.payments.unshift({id:order.id,weddingId:w.id,amount, status:"created",createdAt:new Date().toISOString()});writeDB(db);res.json({orderId:order.id,amount,currency:"INR",keyId:RAZORPAY_KEY_ID});}catch(e){res.status(500).json({error:e.error?.description||e.message||"Unable to create payment order"});}});
app.post("/api/payments/verify",(req,res)=>{try{const w=customerFrom(req);if(!w)return res.status(401).json({error:"Invalid customer access"});const {razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body;const expected=crypto.createHmac("sha256",RAZORPAY_KEY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(String(razorpay_signature||""))))return res.status(400).json({error:"Payment signature verification failed"});const db=readDB();const p=db.payments.find(x=>x.id===razorpay_order_id);if(p){p.status="paid";p.paymentId=razorpay_payment_id;}w.paid=true;w.paidAt=new Date().toISOString();writeDB(db);res.json({ok:true,paid:true});}catch(e){res.status(400).json({error:"Payment verification failed"});}});

app.get("/api/weddings", (req,res)=>res.json(readDB().weddings.map(w=>({id:w.id,name:w.name,createdAt:w.createdAt,files:(w.files||[]).length}))));
app.post("/api/weddings", (req,res)=>{const name=String(req.body.name||"").trim();if(!name)return res.status(400).json({error:"Wedding name is required."});const db=readDB();const wedding={id:crypto.randomUUID(),name,createdAt:new Date().toISOString(),files:[],price:0,paid:false,accessCode:crypto.randomBytes(5).toString("hex").toUpperCase()};db.weddings.unshift(wedding);writeDB(db);res.json(publicWedding(wedding));});
app.get("/api/weddings/:id/files",(req,res)=>{const db=readDB(),w=db.weddings.find(x=>x.id===req.params.id);if(!w)return res.status(404).json({error:"Wedding not found."});res.json(w.files||[]);});

app.post("/api/upload/start",(req,res)=>{const {weddingId,fileName,size,mime}=req.body;if(!weddingId||!fileName||!Number.isFinite(Number(size)))return res.status(400).json({error:"weddingId, fileName and size are required."});const fileSize=Number(size);if(fileSize>MAX_FILE_BYTES)return res.status(413).json({error:"File is larger than 20 GB."});const db=readDB(),w=db.weddings.find(x=>x.id===weddingId);if(!w)return res.status(404).json({error:"Wedding not found."});const id=crypto.randomUUID(),tempPath=path.join(DATA,`${id}.part`);fs.closeSync(fs.openSync(tempPath,"w"));const meta={id,weddingId,fileName:safeName(fileName),size:fileSize,mime:mime||"application/octet-stream",received:0,tempPath,createdAt:new Date().toISOString()};fs.writeFileSync(path.join(DATA,`${id}.json`),JSON.stringify(meta));res.json({uploadId:id,chunkBytes:CHUNK_BYTES});});
app.post("/api/upload/:id/chunk",upload.single("chunk"),(req,res)=>{const metaPath=path.join(DATA,`${req.params.id}.json`);if(!fs.existsSync(metaPath))return res.status(404).json({error:"Upload session not found."});if(!req.file)return res.status(400).json({error:"Chunk is missing."});const meta=JSON.parse(fs.readFileSync(metaPath,"utf8")),start=Number(req.headers["x-chunk-start"]||meta.received);if(start!==meta.received){fs.unlinkSync(req.file.path);return res.status(409).json({error:"Wrong chunk position.",received:meta.received});}const chunkSize=req.file.size;if(meta.received+chunkSize>meta.size){fs.unlinkSync(req.file.path);return res.status(400).json({error:"Chunk exceeds file size."});}fs.appendFileSync(meta.tempPath,fs.readFileSync(req.file.path));fs.unlinkSync(req.file.path);meta.received+=chunkSize;fs.writeFileSync(metaPath,JSON.stringify(meta));res.json({received:meta.received,total:meta.size,complete:meta.received===meta.size});});
app.post("/api/upload/:id/finish",(req,res)=>{const metaPath=path.join(DATA,`${req.params.id}.json`);if(!fs.existsSync(metaPath))return res.status(404).json({error:"Upload session not found."});const meta=JSON.parse(fs.readFileSync(metaPath,"utf8"));if(meta.received!==meta.size)return res.status(400).json({error:"Upload is incomplete.",received:meta.received});const ext=path.extname(meta.fileName),stored=`${meta.id}${ext}`,finalPath=path.join(UPLOADS,stored);fs.renameSync(meta.tempPath,finalPath);const db=readDB(),w=db.weddings.find(x=>x.id===meta.weddingId);if(!w)return res.status(404).json({error:"Wedding not found."});const item={id:meta.id,name:meta.fileName,mime:meta.mime,size:meta.size,url:`/media/${encodeURIComponent(stored)}`,uploadedAt:new Date().toISOString()};w.files=w.files||[];w.files.unshift(item);writeDB(db);fs.unlinkSync(metaPath);res.json(item);});
app.get("/media/:file",(req,res)=>{const file=path.basename(decodeURIComponent(req.params.file)),full=path.join(UPLOADS,file);if(!fs.existsSync(full))return res.status(404).end();res.sendFile(full);});
app.delete("/api/weddings/:weddingId/files/:fileId",(req,res)=>{const db=readDB(),w=db.weddings.find(x=>x.id===req.params.weddingId);if(!w)return res.status(404).json({error:"Wedding not found."});const idx=(w.files||[]).findIndex(f=>f.id===req.params.fileId);if(idx<0)return res.status(404).json({error:"File not found."});const item=w.files[idx],stored=path.basename(decodeURIComponent(item.url.replace("/media/",""))),full=path.join(UPLOADS,stored);if(fs.existsSync(full))fs.unlinkSync(full);w.files.splice(idx,1);writeDB(db);res.json({ok:true});});
app.get("/api/health",(req,res)=>res.json({ok:true,service:"Nandani Wedding Gallery",paymentGateway:!!razorpay}));
app.listen(PORT,"0.0.0.0",()=>console.log(`Nandani Wedding Gallery running on port ${PORT}`));
