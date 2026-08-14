async function api(url, options={}) {
  const r = await fetch(url, { credentials:"same-origin", ...options });
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function openCreate(){$("modal").classList.remove("hidden");$("wName").focus()}
function closeCreate(){$("modal").classList.add("hidden");$("createForm").reset();$("createError").textContent=""}
async function load(){
  try{
    const me=await api("/api/auth/me");
    if(!me.authenticated||me.role!=="admin") return;
    $("loginPanel").classList.add("hidden");$("dashboard").classList.remove("hidden");
    const list=await api("/api/admin/weddings");
    $("customers").innerHTML=list.length?list.map(w=>`
      <article class="admin-card">
        <div><h3>${esc(w.name)}</h3><div><b>${esc(w.customerName)}</b> · ${esc(w.customerMobile||"No mobile")}</div>
        <div class="muted">Wedding ID: <b>${esc(w.loginId)}</b> · Files: ${w.filesCount} · ₹${Number(w.price||0).toLocaleString("en-IN")}</div></div>
        <div class="actions"><button onclick="openGallery('${w.id}')">📁 Gallery</button><button onclick="togglePaid('${w.id}','${w.paymentStatus}')">${w.paymentStatus==="paid"?"↩️ Unpaid":"✅ Paid"}</button><button onclick="removeWedding('${w.id}')">🗑️ Delete</button></div>
      </article>`).join(""):`<div class="muted">अभी कोई customer नहीं है.</div>`;
  }catch(e){console.error(e)}
}
$("loginForm").addEventListener("submit",async e=>{
 e.preventDefault();$("loginError").textContent="";
 try{await api("/api/auth/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:$("username").value,password:$("password").value})});$("password").value="";load();}
 catch(err){$("loginError").textContent=err.message}
});
$("createForm").addEventListener("submit",async e=>{
 e.preventDefault();$("createError").textContent="";
 try{
  const w=await api("/api/admin/weddings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
   name:$("wName").value,customerName:$("cName").value,customerMobile:$("cMobile").value,customerEmail:$("cEmail").value,price:$("price").value,accessCode:$("accessCode").value
  })});
  closeCreate();
  $("createdBox").classList.remove("hidden");
  $("createdBox").innerHTML=`<b>Customer बन गया!</b><br>Wedding ID: <strong>${esc(w.loginId)}</strong><br>Access Code: <strong>${esc(w.accessCode)}</strong><br><small>यह code सुरक्षित जगह पर customer को दें.</small>`;
  load();
 }catch(err){$("createError").textContent=err.message}
});
async function togglePaid(id,status){try{await api(`/api/admin/weddings/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({paymentStatus:status==="paid"?"unpaid":"paid"})});load()}catch(e){alert(e.message)}}
async function removeWedding(id){if(!confirm("इस wedding और उसकी files को delete करें?"))return;try{await api(`/api/admin/weddings/${id}`,{method:"DELETE"});load()}catch(e){alert(e.message)}}
function openGallery(id){location.href=`/admin-gallery.html?id=${encodeURIComponent(id)}`}
async function logout(){await api("/api/auth/logout",{method:"POST"});location.reload()}
load();