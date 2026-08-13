let currentWedding = null;
const $ = id => document.getElementById(id);
const fmt = bytes => {
  if (!bytes) return "0 B";
  const u=["B","KB","MB","GB","TB"], i=Math.floor(Math.log(bytes)/Math.log(1024));
  return `${(bytes/Math.pow(1024,i)).toFixed(i?1:0)} ${u[i]}`;
};

async function api(url, options={}) {
  const r = await fetch(url, options);
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function loadWeddings() {
  const list = await api("/api/weddings");
  $("weddings").innerHTML = list.length ? list.map(w => `
    <div class="wedding" onclick="openGallery('${w.id}')">
      <div class="icon">💍</div>
      <h3>${escapeHtml(w.name)}</h3>
      <div class="muted">${w.files?.length || 0} files</div>
    </div>`).join("") : `<div class="muted">अभी कोई album नहीं है. ऊपर “नया Wedding” दबाएँ.</div>`;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}

function openModal(){ $("modal").classList.remove("hidden"); $("weddingName").focus(); }
function closeModal(){ $("modal").classList.add("hidden"); $("weddingName").value=""; }
async function createWedding(){
  const name=$("weddingName").value.trim();
  if(!name) return alert("Wedding name लिखें.");
  try{await api("/api/weddings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});closeModal();loadWeddings();}
  catch(e){alert(e.message)}
}
function showHelp(){$("help").classList.remove("hidden")}
function hideHelp(){$("help").classList.add("hidden")}

async function openGallery(id){
  const list=await api("/api/weddings");
  currentWedding=list.find(w=>w.id===id);
  if(!currentWedding)return;
  $("galleryTitle").textContent=currentWedding.name;
  $("galleryPanel").classList.remove("hidden");
  document.querySelector("main").scrollIntoView({behavior:"smooth"});
  loadFiles();
}
function closeGallery(){$("galleryPanel").classList.add("hidden");currentWedding=null}
async function loadFiles(){
  if(!currentWedding)return;
  const files=await api(`/api/weddings/${currentWedding.id}/files`);
  $("files").innerHTML=files.length?files.map(f=>{
    const isVideo=f.mime.startsWith("video/");
    return `<article class="media-card">
      ${isVideo?`<video controls preload="metadata" src="${f.url}"></video>`:`<img loading="lazy" src="${f.url}" alt="">`}
      <div class="media-info">
        <div class="media-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
        <div class="muted">${fmt(f.size)}</div>
        <div class="actions"><a href="${f.url}" download>⬇️ Download</a><button onclick="deleteFile('${f.id}')">🗑️ Delete</button></div>
      </div>
    </article>`
  }).join(""):`<div class="muted">इस album में अभी कोई photo/video नहीं है.</div>`;
}
$("fileInput").addEventListener("change", e => {
  [...e.target.files].forEach(uploadFile);
  e.target.value="";
});

async function uploadFile(file){
  const max=20*1024*1024*1024;
  if(file.size>max){alert(`${file.name} 20 GB से बड़ा है.`);return}
  const row=document.createElement("div");
  row.className="upload-row";
  row.innerHTML=`<b>${escapeHtml(file.name)}</b><span class="muted"> — ${fmt(file.size)}</span><div class="bar"><i></i></div><div class="muted status">Starting...</div>`;
  $("uploads").prepend(row);
  const bar=row.querySelector("i"), status=row.querySelector(".status");
  try{
    const start=await api("/api/upload/start",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({weddingId:currentWedding.id,fileName:file.name,size:file.size,mime:file.type})});
    const chunkSize=start.chunkBytes;
    let offset=0;
    while(offset<file.size){
      const blob=file.slice(offset,Math.min(offset+chunkSize,file.size));
      const fd=new FormData();fd.append("chunk",blob,"chunk");
      const r=await fetch(`/api/upload/${start.uploadId}/chunk`,{method:"POST",headers:{"X-Chunk-Start":String(offset)},body:fd});
      const d=await r.json();if(!r.ok)throw new Error(d.error||"Chunk upload failed");
      offset=d.received;
      const pct=Math.round(offset/file.size*100);
      bar.style.width=pct+"%";status.textContent=`Uploading… ${pct}% (${fmt(offset)} / ${fmt(file.size)})`;
    }
    await api(`/api/upload/${start.uploadId}/finish`,{method:"POST"});
    status.textContent="✅ Upload complete";
    loadFiles();loadWeddings();
  }catch(e){status.textContent="❌ "+e.message}
}

async function deleteFile(id){
  if(!confirm("यह file delete करें?"))return;
  try{await api(`/api/weddings/${currentWedding.id}/files/${id}`,{method:"DELETE"});loadFiles();loadWeddings();}
  catch(e){alert(e.message)}
}
loadWeddings();
