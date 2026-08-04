
(()=>{const CUR=window.APP_CONFIG?.APP_VERSION||'6.2.2';
const cmp=(a,b)=>{a=a.split('.').map(Number);b=b.split('.').map(Number);for(let i=0;i<3;i++){if((a[i]||0)!=(b[i]||0))return(a[i]||0)-(b[i]||0);}return 0;};
document.addEventListener('DOMContentLoaded',async()=>{
try{
const r=await fetch('./version.json?'+Date.now(),{cache:'no-store'});
const v=await r.json();
if(cmp(CUR,v.latest)>=0)return;
if(!v.mandatory&&localStorage.getItem('cev_hide')>Date.now())return;
const d=document.createElement('div');
d.id='version-update-banner';
d.style.cssText='position:fixed;left:16px;right:16px;bottom:16px;background:#145637;color:#fff;padding:16px;border-radius:12px;z-index:9999;box-shadow:0 8px 25px rgba(0,0,0,.25)';
d.innerHTML=`<b>${v.title}</b><br>${v.message}<br><br>
<a href="${v.url}" style="background:#fff;color:#145637;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:bold">Aggiorna</a>
<button id=x style="margin-left:10px">Più tardi</button>`;
document.body.appendChild(d);
document.getElementById('x').onclick=()=>{localStorage.setItem('cev_hide',Date.now()+((v.remind_after_hours||24)*3600000));d.remove();};
}catch(e){}
});})();
