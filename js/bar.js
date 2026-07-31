const $ = id => document.getElementById(id);
let selectedProduct = null;

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function euro(v){return new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(Number(v||0));}
function showMessage(text,type='success'){const b=$('bar-message');b.textContent=text;b.className=`message show ${type}`;}
function todayIso(){const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10);}

async function loadProducts(){
  const box=$('bar-products');
  const {data,error}=await db.from('bar_prodotti').select('*').eq('attivo',true).order('ordine').order('creato_il');
  if(error){box.innerHTML='<p class="field-error">Impossibile caricare le proposte. Esegui prima il file SQL della Versione 6.</p>';return;}
  if(!data.length){box.innerHTML='<p>Nessuna proposta disponibile al momento.</p>';return;}
  box.innerHTML=data.map(p=>`<article class="bar-product-card" data-id="${p.id}">
    <div class="bar-product-image">${p.immagine_url?`<img src="${esc(p.immagine_url)}" alt="${esc(p.nome)}">`:'<span>🍹</span>'}</div>
    <div class="bar-product-body"><h3>${esc(p.nome)}</h3><p>${esc(p.descrizione||'')}</p><strong>${euro(p.prezzo)}</strong><button class="primary bar-select-product" data-id="${p.id}" type="button">Scegli e prenota</button></div>
  </article>`).join('');
  box.querySelectorAll('.bar-select-product').forEach(btn=>btn.addEventListener('click',()=>{
    selectedProduct=data.find(p=>p.id===btn.dataset.id);
    $('bar-selected-product').innerHTML=`<strong>${esc(selectedProduct.nome)}</strong> · ${euro(selectedProduct.prezzo)}`;
    $('bar-booking-panel').scrollIntoView({behavior:'smooth',block:'start'});
  }));
}

async function book(){
  if(!selectedProduct)return showMessage('Seleziona prima un aperitivo o un tagliere.','error');
  const payload={prodotto_id:selectedProduct.id,nome_cliente:$('bar-nome').value.trim(),telefono:$('bar-telefono').value.trim(),persone:Number($('bar-persone').value),data:$('bar-data').value,ora:$('bar-ora').value,note:$('bar-note').value.trim()||null};
  if(!payload.nome_cliente||!payload.telefono||!payload.data||!payload.ora||payload.persone<1)return showMessage('Compila tutti i campi obbligatori.','error');
  if(!$('bar-privacy').checked)return showMessage('Devi accettare il consenso privacy.','error');
  $('bar-prenota').disabled=true;
  const {error}=await db.from('bar_prenotazioni').insert(payload);
  $('bar-prenota').disabled=false;
  if(error)return showMessage('Prenotazione non riuscita: '+error.message,'error');
  showMessage('Prenotazione aperitivo confermata. Il gestore la vedrà subito.','success');
  ['bar-nome','bar-telefono','bar-note'].forEach(id=>$(id).value='');$('bar-privacy').checked=false;
}

document.addEventListener('DOMContentLoaded',()=>{$('bar-data').min=todayIso();$('bar-data').value=todayIso();$('bar-prenota').addEventListener('click',book);loadProducts();});
