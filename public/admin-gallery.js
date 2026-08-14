let weddingId=null;
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const fmt=b=>{if(!b)return"0 B";const u=["B","KB","MB","GB","TB"],i=Math.floor(Math.log(b)/Math.log(1024));return`${(b/1024**i).toFixed(i?1:0)} ${u[i]}`};
async function api(url,opt={}){const r=await fetch(url,{credentials:"same-origin",...opt});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Request failed");return d}
async function init(){
 const me=await api("/api/auth/me"); if(!me.authenticated||me.role!=="admin"){location.href="/admin.html";return}
 weddingId=new URLSearchParams(location.search).get("id"); if(!weddingId){location.href="/admin.html";return}
 const list=await api("/api/admin/weddings");const w=list.find(x=>x.id===weddingId);if(!w){alert("Wedding not found");location.href="/admin.html";return}
 $("title").textContent=`${w.name}`;$("sub").textContent=`${w.customerName} · ${w.loginId}`;loadFiles();
}
async function loadFiles(){
 const files=await api(`/api/weddings/${weddingId}/files`);
 $("files").innerHTML=files.length?files.map(f=>`<article class="media-card">${f.mime.startsWith("video/")?`<video controls preload="metadata" src="${f.url}"></video>`:`<img loading="lazy" src="${f.url}" alt="">`}<div class="media-info"><div class="media-name">${esc(f.name)}</div><div class="muted">${fmt(f.size)}</div><div class="actions"><a href="${f.url}" download>⬇️ Download</a><button onclick="deleteFile('${f.id}')">🗑️ Delete</button></div></div></article>`).join(""):`<div class="muted">अभी कोई file नहीं है.</div>`;
}
$("fileInput").addEventListener("change",e=>{[...e.target.files].forEach(uploadFile);e.target.value=""});
async function uploadFile(file){
 const max=20*1024*1024*1024;if(file.size>max){alert("File 20 GB से बड़ी है.");return}
 const row=document.createElement("div");row.className="upload-row";row.innerHTML=`<b>${esc(file.name)}</b><span class="muted"> — ${fmt(file.size)}</span><div class="bar"><i></i></div><div class="muted status">Starting...</div>`;$("uploads").prepend(row);
 const bar=row.querySelector("i"),status=row.querySelector(".status");
 try{
  const s=await api("/api/upload/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({weddingId,fileName:file.name,size:file.size,mime:file.type})});
  let offset=0;while(offset<file.size){const blob=file.slice(offset,Math.min(offset+s.chunkBytes,file.size));const fd=new FormData();fd.append("chunk",blob,"chunk");const r=await fetch(`/api/upload/${s.uploadId}/chunk`,{method:"POST",headers:{"X-Chunk-Start":String(offset)},body:fd});const d=await r.json();if(!r.ok)throw Error(d.error||"Chunk failed");offset=d.received;const pct=Math.round(offset/file.size*100);bar.style.width=pct+"%";status.textContent=`Uploading… ${pct}% (${fmt(offset)} / ${fmt(file.size)})`}
  await api(`/api/upload/${s.uploadId}/finish`,{method:"POST"});status.textContent="✅ Upload complete";loadFiles();
 }catch(e){status.textContent="❌ "+e.message}
}
async function deleteFile(id){if(!confirm("File delete करें?"))return;try{await api(`/api/weddings/${weddingId}/files/${id}`,{method:"DELETE"});loadFiles()}catch(e){alert(e.message)}}
async function logout(){await api("/api/auth/logout",{method:"POST"});location.href="/admin.html"}
init();