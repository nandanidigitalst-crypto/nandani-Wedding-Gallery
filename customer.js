async function api(url, options={}) {
 const r=await fetch(url,{credentials:"same-origin",...options});
 const data=await r.json().catch(()=>({}));
 if(!r.ok) throw new Error(data.error||"Request failed"); return data;
}
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const fmt=b=>{if(!b)return"0 B";const u=["B","KB","MB","GB","TB"],i=Math.floor(Math.log(b)/Math.log(1024));return`${(b/1024**i).toFixed(i?1:0)} ${u[i]}`};
async function load(){
 try{
  const me=await api("/api/auth/me");
  if(me.authenticated&&me.role==="customer"){showGallery(me.wedding)}
 }catch(e){}
}
function showGallery(w){
 $("loginPanel").classList.add("hidden");$("gallery").classList.remove("hidden");
 $("title").textContent=`💍 ${w.name}`;$("customer").textContent=`Welcome ${w.customerName||"Customer"} · Wedding ID: ${w.loginId}`;
 loadFiles(w.id);
}
async function loadFiles(id){
 try{
  const files=await api(`/api/weddings/${id}/files`);
  $("files").innerHTML=files.length?files.map(f=>{
   const video=f.mime.startsWith("video/");
   return `<article class="media-card">${video?`<video controls preload="metadata" src="${f.url}"></video>`:`<img loading="lazy" src="${f.url}" alt="">`}<div class="media-info"><div class="media-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="muted">${fmt(f.size)}</div><div class="actions"><a href="${f.url}" download>⬇️ Download</a></div></div></article>`;
  }).join(""):`<div class="muted">अभी gallery में कोई photo/video नहीं है.</div>`;
 }catch(e){$("files").innerHTML=`<div class="error">${esc(e.message)}</div>`}
}
$("loginForm").addEventListener("submit",async e=>{
 e.preventDefault();$("loginError").textContent="";
 try{
  const me=await api("/api/auth/customer/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({loginId:$("loginId").value,accessCode:$("accessCode").value})});
  showGallery(me.wedding);
 }catch(err){$("loginError").textContent=err.message}
});
async function logout(){await api("/api/auth/logout",{method:"POST"});location.reload()}
load();