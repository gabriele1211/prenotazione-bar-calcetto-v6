const $ = id => document.getElementById(id);
let products = [];
let loadedBookings = [];
let bookingRefreshTimer = null;
let bookingsLoading = false;
const ORIGINAL_PAGE_TITLE = document.title;
const BOOKING_REFRESH_MS = 30 * 1000;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function euro(value) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(value || 0));
}

function localDate(value) {
  if (!value) return "—";
  return new Date(`${value}T12:00:00`).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fullLocalDate(value) {
  if (!value) return "—";
  return new Date(`${value}T12:00:00`).toLocaleDateString("it-IT", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
}

function waitMinutes(value) {
  const created = new Date(value).getTime();
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / 60000));
}

function waitLabel(value) {
  const minutes = waitMinutes(value);
  if (minutes === 0) return "Ricevuta adesso";
  if (minutes === 1) return "Attende da 1 minuto";
  return `Attende da ${minutes} minuti`;
}

function urgencyClass(value) {
  const minutes = waitMinutes(value);
  if (minutes >= 20) return "critical";
  if (minutes >= 10) return "urgent";
  return "fresh";
}

function message(text, type = "success", id = "bar-admin-message") {
  const box = $(id);
  box.textContent = text;
  box.className = `message show ${type}`;
}

function storagePathFromUrl(url) {
  if (!url) return null;
  const marker = "/storage/v1/object/public/bar-immagini/";
  const index = url.indexOf(marker);
  return index < 0 ? null : decodeURIComponent(url.slice(index + marker.length));
}

function whatsappNumber(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("3")) digits = `39${digits}`;
  return digits;
}

function statusLabel(status) {
  return ({
    da_confermare: "Da confermare",
    confermata: "Confermata",
    rifiutata: "Rifiutata",
    annullata: "Annullata"
  })[status] || status;
}

function statusClass(status) {
  if (status === "da_confermare") return "status-pending";
  if (status === "confermata") return "status-confirmed";
  return "status-cancelled";
}

async function checkSession() {
  const { data } = await db.auth.getSession();
  const authenticated = Boolean(data.session);
  $("bar-login-box").classList.toggle("hidden", authenticated);
  $("bar-dashboard").classList.toggle("hidden", !authenticated);
  if (authenticated) {
    await Promise.all([loadProducts(), loadBookings(), loadClosureSummary()]);
    startBookingAutoRefresh();
  } else {
    stopBookingAutoRefresh();
  }
}

async function login() {
  const { error } = await db.auth.signInWithPassword({
    email: $("bar-login-email").value.trim(),
    password: $("bar-login-password").value
  });
  if (error) return message(`Accesso non riuscito: ${error.message}`, "error", "bar-login-message");
  await checkSession();
}

function resetForm() {
  $("bar-product-id").value = "";
  $("bar-product-name").value = "";
  $("bar-product-description").value = "";
  $("bar-product-price").value = "";
  $("bar-product-people").value = "1";
  $("bar-product-order").value = "0";
  $("bar-product-active").checked = true;
}

async function saveProduct(event) {
  event.preventDefault();
  const id = $("bar-product-id").value;
  const payload = {
    nome: $("bar-product-name").value.trim(),
    descrizione: $("bar-product-description").value.trim() || null,
    prezzo: Number($("bar-product-price").value || 0),
    persone_incluse: Number($("bar-product-people").value || 1),
    ordine: Number($("bar-product-order").value || 0),
    attivo: $("bar-product-active").checked,
    aggiornato_il: new Date().toISOString()
  };

  if (!payload.nome) return message("Inserisci il nome della proposta.", "error");
  if (!Number.isFinite(payload.prezzo) || payload.prezzo < 0) return message("Inserisci un prezzo valido.", "error");
  if (!Number.isInteger(payload.persone_incluse) || payload.persone_incluse < 1 || payload.persone_incluse > 30) {
    return message("Le persone comprese devono essere un numero da 1 a 30.", "error");
  }

  const query = id
    ? db.from("bar_prodotti").update(payload).eq("id", id)
    : db.from("bar_prodotti").insert(payload);
  const { error } = await query;
  if (error) return message(`Salvataggio non riuscito: ${error.message}`, "error");

  message(id ? "Proposta aggiornata." : "Proposta creata.");
  resetForm();
  await loadProducts();
}

function editProduct(id) {
  const product = products.find(item => item.id === id);
  if (!product) return;
  $("bar-product-id").value = product.id;
  $("bar-product-name").value = product.nome;
  $("bar-product-description").value = product.descrizione || "";
  $("bar-product-price").value = product.prezzo;
  $("bar-product-people").value = product.persone_incluse || 1;
  $("bar-product-order").value = product.ordine;
  $("bar-product-active").checked = product.attivo;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function uploadImage(id, file) {
  if (!file?.type.startsWith("image/")) return message("Seleziona un file immagine.", "error");
  if (file.size > 5 * 1024 * 1024) return message("L’immagine non può superare 5 MB.", "error");

  const extension = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${id}/${Date.now()}.${extension}`;
  const current = products.find(product => product.id === id);
  const oldPath = storagePathFromUrl(current?.immagine_url);
  const { error: uploadError } = await db.storage.from("bar-immagini").upload(path, file, {
    upsert: false, contentType: file.type
  });
  if (uploadError) return message(`Caricamento non riuscito: ${uploadError.message}`, "error");

  const { data } = db.storage.from("bar-immagini").getPublicUrl(path);
  const { error } = await db.from("bar_prodotti").update({
    immagine_url: data.publicUrl,
    aggiornato_il: new Date().toISOString()
  }).eq("id", id);
  if (error) {
    await db.storage.from("bar-immagini").remove([path]);
    return message(error.message, "error");
  }
  if (oldPath) await db.storage.from("bar-immagini").remove([oldPath]);
  message("Immagine aggiornata.");
  await loadProducts();
}

async function removeImage(id) {
  const product = products.find(item => item.id === id);
  if (!product?.immagine_url) return;
  const path = storagePathFromUrl(product.immagine_url);
  const { error } = await db.from("bar_prodotti").update({
    immagine_url: null,
    aggiornato_il: new Date().toISOString()
  }).eq("id", id);
  if (error) return message(error.message, "error");
  if (path) await db.storage.from("bar-immagini").remove([path]);
  message("Immagine eliminata.");
  await loadProducts();
}

async function deleteProduct(id) {
  if (!confirm("Eliminare definitivamente questa proposta? Le richieste collegate possono impedirne la cancellazione.")) return;
  const { error } = await db.from("bar_prodotti").delete().eq("id", id);
  if (error) return message(`Proposta non eliminabile: ${error.message}`, "error");
  const product = products.find(item => item.id === id);
  const path = storagePathFromUrl(product?.immagine_url);
  if (path) await db.storage.from("bar-immagini").remove([path]);
  message("Proposta eliminata.");
  await loadProducts();
}

function attachProductActions() {
  document.querySelectorAll(".edit-product").forEach(button => { button.onclick = () => editProduct(button.dataset.id); });
  document.querySelectorAll(".remove-image").forEach(button => { button.onclick = () => removeImage(button.dataset.id); });
  document.querySelectorAll(".delete-product").forEach(button => { button.onclick = () => deleteProduct(button.dataset.id); });

  document.querySelectorAll(".drop-zone").forEach(zone => {
    const input = zone.querySelector("input");
    zone.onclick = () => input.click();
    input.onchange = () => uploadImage(zone.dataset.id, input.files[0]);
    ["dragenter", "dragover"].forEach(name => zone.addEventListener(name, event => {
      event.preventDefault();
      zone.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach(name => zone.addEventListener(name, event => {
      event.preventDefault();
      zone.classList.remove("dragging");
    }));
    zone.addEventListener("drop", event => uploadImage(zone.dataset.id, event.dataTransfer.files[0]));
  });
}

async function loadProducts() {
  const { data, error } = await db.from("bar_prodotti").select("*").order("ordine").order("creato_il");
  if (error) return message(`Errore proposte: ${error.message}. Esegui lo script SQL 09 della Versione 6.2.`, "error");
  products = data || [];
  $("bar-admin-products").innerHTML = products.map(product => {
    const people = Math.max(1, Number(product.persone_incluse || 1));
    return `<article class="bar-admin-card">
      <div class="bar-admin-image drop-zone" data-id="${product.id}">
        ${product.immagine_url ? `<img src="${esc(product.immagine_url)}" alt="${esc(product.nome)}">` : "<span>Trascina qui una foto<br><small>o clicca per scegliere</small></span>"}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
      </div>
      <div class="bar-admin-info">
        <h3>${esc(product.nome)}</h3>
        <p>${esc(product.descrizione || "")}</p>
        <strong>${euro(product.prezzo)} per ${people} ${people === 1 ? "persona" : "persone"}</strong>
        <small>Ordine ${product.ordine} · ${product.attivo ? "Visibile" : "Nascosta"}</small>
        <div class="form-actions">
          <button class="secondary edit-product" data-id="${product.id}" type="button">Modifica</button>
          <button class="secondary remove-image" data-id="${product.id}" type="button" ${product.immagine_url ? "" : "disabled"}>Elimina immagine</button>
          <button class="danger delete-product" data-id="${product.id}" type="button">Elimina proposta</button>
        </div>
      </div>
    </article>`;
  }).join("") || "<p>Nessuna proposta. Creane una con il modulo sopra.</p>";
  attachProductActions();
}

async function loadClosureSummary() {
  const { data, error } = await db.from("impostazioni_prenotazioni")
    .select("prenotazioni_attive,chiusura_dal,chiusura_al,messaggio_chiusura")
    .eq("id", 1)
    .maybeSingle();
  const box = $("bar-closure-summary");
  if (error || !data) {
    box.textContent = "Impossibile caricare le regole di chiusura.";
    return;
  }
  if (data.prenotazioni_attive === false) {
    box.textContent = data.messaggio_chiusura || "Tutte le prenotazioni sono temporaneamente sospese, anche per il bar.";
    return;
  }
  if (data.chiusura_dal && data.chiusura_al) {
    box.textContent = `${data.messaggio_chiusura || "Chiusura programmata"} — dal ${localDate(data.chiusura_dal)} al ${localDate(data.chiusura_al)}. Nelle stesse date sono bloccati campo e aperitivi.`;
    return;
  }
  box.textContent = "Nessuna chiusura programmata. Le richieste aperitivo sono attive.";
}

function preparedWhatsappText(booking, type) {
  const time = String(booking.ora).slice(0, 5);
  const people = Number(booking.persone || 0);
  const quantity = Number(booking.quantita_proposte || 1);
  const product = booking.bar_prodotti?.nome || "aperitivo";
  const proposalLabel = quantity === 1 ? "proposta" : "proposte";
  const peopleLabel = people === 1 ? "persona" : "persone";

  if (type === "conferma") {
    return `Ciao ${booking.nome_cliente}, la tua prenotazione aperitivo presso il Bar Parco Ex Velodromo è confermata per il ${localDate(booking.data)} alle ${time}, per ${people} ${peopleLabel}. Proposta: ${quantity} ${proposalLabel} ${product}. Totale: ${euro(booking.costo_totale)}. Ti aspettiamo!`;
  }

  return `Ciao ${booking.nome_cliente}, ci dispiace, la prenotazione aperitivo richiesta per il ${localDate(booking.data)} alle ${time}, per ${people} ${peopleLabel}, non può essere confermata ed è stata annullata. Se desideri concordare un altro giorno o orario, contattaci. Bar Parco Ex Velodromo.`;
}

function whatsappUrl(booking, type) {
  const number = whatsappNumber(booking.telefono);
  if (!number) return "";
  return `https://wa.me/${number}?text=${encodeURIComponent(preparedWhatsappText(booking, type))}`;
}

function phoneAction(booking) {
  const number = whatsappNumber(booking.telefono);
  return `<a class="bar-action-link phone" href="tel:+${number}">Chiama</a>`;
}

function preparedWhatsappAction(booking, type) {
  const url = whatsappUrl(booking, type);
  const label = type === "conferma" ? "Invia conferma" : "Invia disdetta";
  return `<a class="bar-action-link whatsapp" href="${url}" target="_blank" rel="noopener">${label}</a>`;
}

function contactActions(booking, type = null) {
  return `<div class="bar-contact-actions">
    ${type ? preparedWhatsappAction(booking, type) : ""}
    ${phoneAction(booking)}
  </div>`;
}

function bookingActions(booking) {
  if (booking.stato === "da_confermare") {
    return `${contactActions(booking)}<div class="bar-decision-actions">
      <button class="primary confirm-booking" data-id="${booking.id}" type="button">Conferma + WhatsApp</button>
      <button class="danger reject-booking" data-id="${booking.id}" type="button">Rifiuta + WhatsApp</button>
    </div>`;
  }
  if (booking.stato === "confermata") {
    return `${contactActions(booking, "conferma")}<button class="secondary cancel-booking" data-id="${booking.id}" type="button">Annulla + WhatsApp</button>`;
  }
  return contactActions(booking, "disdetta");
}

function renderPendingBookings(bookings) {
  const pending = bookings
    .filter(booking => booking.stato === "da_confermare")
    .sort((a, b) => new Date(a.creato_il) - new Date(b.creato_il));
  const panel = $("bar-pending-alert");
  panel.hidden = pending.length === 0;
  $("bar-pending-count").textContent = pending.length;
  $("bar-pending-title").textContent = pending.length === 1
    ? "1 richiesta da confermare"
    : `${pending.length} richieste da confermare`;

  panel.classList.remove("has-urgent", "has-critical");
  if (pending.some(booking => urgencyClass(booking.creato_il) === "critical")) panel.classList.add("has-critical");
  else if (pending.some(booking => urgencyClass(booking.creato_il) === "urgent")) panel.classList.add("has-urgent");

  document.title = pending.length ? `(${pending.length}) ⚠ Da confermare · ${ORIGINAL_PAGE_TITLE}` : ORIGINAL_PAGE_TITLE;
  $("bar-pending-list").innerHTML = pending.map(booking => {
    const quantity = Number(booking.quantita_proposte || 1);
    const urgency = urgencyClass(booking.creato_il);
    const urgencyPrefix = urgency === "critical" ? "RISPOSTA URGENTE · " : urgency === "urgent" ? "ATTENZIONE · " : "";
    return `<article class="bar-pending-card ${urgency}">
      <div>
        <span class="bar-wait-time">⏱ ${urgencyPrefix}${esc(waitLabel(booking.creato_il))}</span>
        <h3>${esc(booking.nome_cliente)} · ${Number(booking.persone || 0)} persone</h3>
        <p>${localDate(booking.data)} alle ${String(booking.ora).slice(0, 5)} · ${esc(booking.canale_contatto === "telefono" ? "Preferisce telefonata" : "Preferisce WhatsApp")}</p>
      </div>
      <div>
        <h3>${esc(booking.bar_prodotti?.nome || "Proposta archiviata")}</h3>
        <p>${quantity} ${quantity === 1 ? "proposta" : "proposte"} · <strong>${euro(booking.costo_totale)}</strong></p>
      </div>
      <div>${bookingActions(booking)}</div>
    </article>`;
  }).join("");
}

function renderTodayConfirmed(bookings) {
  const today = localDateKey();
  const confirmed = bookings
    .filter(booking => booking.stato === "confermata" && booking.data === today)
    .sort((a, b) => String(a.ora).localeCompare(String(b.ora)));
  const people = confirmed.reduce((total, booking) => total + Number(booking.persone || 0), 0);
  const revenue = confirmed.reduce((total, booking) => total + Number(booking.costo_totale || 0), 0);

  $("bar-today-date").textContent = fullLocalDate(today);
  $("bar-today-count").textContent = confirmed.length;
  $("bar-today-metrics").innerHTML = `
    <span>${confirmed.length} ${confirmed.length === 1 ? "prenotazione" : "prenotazioni"}</span>
    <span>${people} ${people === 1 ? "persona" : "persone"}</span>
    <span>Totale ${euro(revenue)}</span>`;
  $("bar-today-list").innerHTML = confirmed.length ? confirmed.map(booking => {
    const quantity = Number(booking.quantita_proposte || 1);
    return `<article class="bar-today-card">
      <div class="bar-today-time">${String(booking.ora).slice(0, 5)}</div>
      <div>
        <h3>${esc(booking.bar_prodotti?.nome || "Proposta archiviata")}</h3>
        <p>${quantity} ${quantity === 1 ? "proposta" : "proposte"}</p>
      </div>
      <div>
        <h3>${esc(booking.nome_cliente)}</h3>
        <p>${Number(booking.persone || 0)} persone · ${esc(booking.telefono)}</p>
      </div>
      <div class="bar-today-total">${euro(booking.costo_totale)}</div>
    </article>`;
  }).join("") : '<p class="bar-today-empty">Nessuna prenotazione aperitivo confermata per oggi.</p>';
}

function sortBookingsChronologically(bookings) {
  return [...(bookings || [])].sort((a, b) => {
    const aKey = `${a.data || "9999-12-31"}T${String(a.ora || "23:59").slice(0, 5)}`;
    const bKey = `${b.data || "9999-12-31"}T${String(b.ora || "23:59").slice(0, 5)}`;
    const byDateAndTime = aKey.localeCompare(bKey);
    if (byDateAndTime !== 0) return byDateAndTime;
    return String(a.creato_il || "").localeCompare(String(b.creato_il || ""));
  });
}

function bookingStartTimestamp(booking) {
  const date = String(booking?.data || "");
  const time = String(booking?.ora || "").slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return Number.NaN;
  const timestamp = new Date(`${date}T${time}:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function isPastBooking(booking, now = new Date()) {
  const start = bookingStartTimestamp(booking);
  if (!Number.isFinite(start)) return false;
  const nowTimestamp = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return nowTimestamp >= start + (60 * 60 * 1000);
}

function sortBookingsForManagement(bookings, now = new Date()) {
  const nowTimestamp = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return [...(bookings || [])].sort((a, b) => {
    const aTimestamp = bookingStartTimestamp(a);
    const bTimestamp = bookingStartTimestamp(b);
    const aValid = Number.isFinite(aTimestamp);
    const bValid = Number.isFinite(bTimestamp);
    const aPast = aValid && nowTimestamp >= aTimestamp + (60 * 60 * 1000);
    const bPast = bValid && nowTimestamp >= bTimestamp + (60 * 60 * 1000);

    // Prima le prenotazioni imminenti in ordine crescente; in fondo lo storico,
    // dalla prenotazione passata piu recente alla piu vecchia.
    const aGroup = aValid ? (aPast ? 1 : 0) : 2;
    const bGroup = bValid ? (bPast ? 1 : 0) : 2;
    if (aGroup !== bGroup) return aGroup - bGroup;
    if (aTimestamp !== bTimestamp) return aPast ? bTimestamp - aTimestamp : aTimestamp - bTimestamp;
    return String(a.creato_il || "").localeCompare(String(b.creato_il || ""));
  });
}

function matchesPrintStatus(booking, status) {
  if (!status) return true;
  if (status === "rifiutata_annullata") return ["rifiutata", "annullata"].includes(booking.stato);
  return booking.stato === status;
}

function selectBookingsForPrint({ from = "", to = "", status = "" } = {}) {
  return sortBookingsChronologically(loadedBookings.filter(booking => {
    if (from && booking.data < from) return false;
    if (to && booking.data > to) return false;
    return matchesPrintStatus(booking, status);
  }));
}

function printPeriodLabel(from, to) {
  if (from && to && from === to) return fullLocalDate(from);
  if (from && to) return `Dal ${localDate(from)} al ${localDate(to)}`;
  if (from) return `Dal ${localDate(from)}`;
  if (to) return `Fino al ${localDate(to)}`;
  return "Intero archivio";
}

function openBookingsPrint(title, periodLabel, bookings) {
  if (!bookings.length) {
    alert("Non ci sono prenotazioni corrispondenti alla scelta effettuata.");
    return;
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Il browser ha bloccato la finestra di stampa. Consenti i popup per questo sito e riprova.");
    return;
  }

  const logoUrl = new URL("./assets/gf-logo.png", window.location.href).href;
  const people = bookings.reduce((total, booking) => total + Number(booking.persone || 0), 0);
  const confirmed = bookings.filter(booking => booking.stato === "confermata");
  const confirmedTotal = confirmed.reduce((total, booking) => total + Number(booking.costo_totale || 0), 0);
  const rows = bookings.map((booking, index) => {
    const quantity = Number(booking.quantita_proposte || 1);
    const product = booking.bar_prodotti?.nome || "Proposta archiviata";
    return `<tr>
      <td>${index + 1}</td>
      <td><strong>${localDate(booking.data)}</strong><br>${String(booking.ora).slice(0, 5)}</td>
      <td><strong>${esc(product)}</strong><br>${quantity} ${quantity === 1 ? "proposta" : "proposte"}</td>
      <td><strong>${esc(booking.nome_cliente || "—")}</strong><br>${esc(booking.telefono || "—")}</td>
      <td>${Number(booking.persone || 0)}</td>
      <td><strong>${euro(booking.costo_totale)}</strong></td>
      <td>${esc(booking.note || "—")}</td>
      <td>${esc(statusLabel(booking.stato))}</td>
    </tr>`;
  }).join("");
  const generatedAt = new Date().toLocaleString("it-IT", { dateStyle: "full", timeStyle: "short" });

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: A4 landscape; margin: 11mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #1f2937; font-family: Arial, Helvetica, sans-serif; font-size: 10px; }
.toolbar { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 13px; padding-bottom: 10px; border-bottom: 1px solid #cbd5e1; }
.toolbar button { padding: 8px 12px; border: 1px solid #9ca3af; border-radius: 7px; background: #fff; font-weight: 700; cursor: pointer; }
.header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-bottom: 10px; border-bottom: 3px solid #8a431d; }
.header img { width: 72px; height: auto; }
h1 { margin: 0 0 5px; color: #713917; font-size: 21px; }
.period { margin: 0; color: #4b5563; font-size: 12px; }
.summary { display: flex; gap: 8px; flex-wrap: wrap; margin: 13px 0; }
.summary span { padding: 6px 9px; border: 1px solid #d7c0aa; border-radius: 6px; background: #fff8ef; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 5px; border: 1px solid #aeb6c1; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { color: #713917; background: #f4e6d9; font-size: 9px; }
tbody tr:nth-child(even) { background: #fafafa; }
.footer { margin-top: 11px; padding-top: 7px; border-top: 1px solid #d1d5db; color: #6b7280; font-size: 9px; }
@media print { .no-print { display: none !important; } thead { display: table-header-group; } tr { break-inside: avoid; } }
</style></head><body>
<div class="toolbar no-print">
  <button type="button" onclick="window.opener?.focus(); window.close();">← Torna all’Area gestore</button>
  <button type="button" onclick="window.print()">🖨️ Stampa / salva PDF</button>
</div>
<div class="header"><div><h1>${esc(title)}</h1><p class="period">${esc(periodLabel)}</p></div><img src="${logoUrl}" alt="GF"></div>
<div class="summary">
  <span><strong>Prenotazioni:</strong> ${bookings.length}</span>
  <span><strong>Confermate:</strong> ${confirmed.length}</span>
  <span><strong>Persone:</strong> ${people}</span>
  <span><strong>Totale confermato:</strong> ${euro(confirmedTotal)}</span>
</div>
<table>
  <thead><tr><th>N.</th><th>Data e ora</th><th>Proposta</th><th>Cliente e telefono</th><th>Persone</th><th>Totale</th><th>Note</th><th>Stato</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">Generato ${esc(generatedAt)} · Documento ad uso gestionale contenente dati personali · Versione 6.2.6</div>
<script>window.addEventListener("load", () => setTimeout(() => { window.focus(); window.print(); }, 500));<\/script>
</body></html>`);
  printWindow.document.close();
}

function printDailyBookings() {
  const date = $("bar-print-daily-date").value;
  if (!date) return alert("Seleziona la giornata da stampare.");
  const bookings = selectBookingsForPrint({ from: date, to: date, status: "confermata" });
  openBookingsPrint("Prenotazioni aperitivo della giornata", fullLocalDate(date), bookings);
}

function printBookingsRange() {
  const from = $("bar-print-from").value;
  const to = $("bar-print-to").value;
  const status = $("bar-print-status").value;
  if (!from || !to) return alert("Seleziona sia la data iniziale sia quella finale.");
  if (from > to) return alert("La data finale deve essere successiva o uguale a quella iniziale.");
  const bookings = selectBookingsForPrint({ from, to, status });
  const statusText = status ? ` · ${status === "rifiutata_annullata" ? "Rifiutate e annullate" : statusLabel(status)}` : " · Tutti gli stati";
  openBookingsPrint("Prenotazioni aperitivo", `${printPeriodLabel(from, to)}${statusText}`, bookings);
}

function printAllBookings() {
  openBookingsPrint("Archivio completo prenotazioni aperitivo", "Tutte le richieste, in ordine crescente per data e ora", selectBookingsForPrint());
}

function initializePrintControls() {
  const today = localDateKey();
  $("bar-print-daily-date").value = today;
  $("bar-print-from").value = today;
  $("bar-print-to").value = today;
  $("bar-print-daily").onclick = printDailyBookings;
  $("bar-print-range").onclick = printBookingsRange;
  $("bar-print-all").onclick = printAllBookings;
}

function startBookingAutoRefresh() {
  if (bookingRefreshTimer) return;
  bookingRefreshTimer = window.setInterval(() => {
    if (!document.hidden) loadBookings();
  }, BOOKING_REFRESH_MS);
}

function stopBookingAutoRefresh() {
  if (bookingRefreshTimer) window.clearInterval(bookingRefreshTimer);
  bookingRefreshTimer = null;
  document.title = ORIGINAL_PAGE_TITLE;
}

async function updateBookingStatus(id, status) {
  const labels = { confermata: "confermare", rifiutata: "rifiutare", annullata: "annullare" };
  const booking = loadedBookings.find(item => String(item.id) === String(id));
  if (!booking) return message("Richiesta non trovata. Aggiorna l’elenco e riprova.", "error");

  const messageType = status === "confermata" ? "conferma" : "disdetta";
  const actionText = status === "confermata" ? "il messaggio di conferma" : "il messaggio di disdetta";
  if (!confirm(`Vuoi ${labels[status]} questa richiesta? Dopo l’aggiornamento si aprirà WhatsApp con ${actionText} già pronto.`)) return;

  const url = whatsappUrl(booking, messageType);
  const whatsappTab = url ? window.open("about:blank", "_blank") : null;
  if (whatsappTab) whatsappTab.opener = null;

  const { error } = await db.from("bar_prenotazioni").update({
    stato: status,
    aggiornato_il: new Date().toISOString()
  }).eq("id", id);
  if (error) {
    if (whatsappTab) whatsappTab.close();
    return message(`Aggiornamento non riuscito: ${error.message}`, "error");
  }

  await loadBookings();
  if (!url) return message("Stato aggiornato, ma il numero di telefono non è valido per WhatsApp.", "error");
  if (whatsappTab) whatsappTab.location.replace(url);
  else window.location.href = url;
}

function attachBookingActions() {
  document.querySelectorAll(".confirm-booking").forEach(button => { button.onclick = () => updateBookingStatus(button.dataset.id, "confermata"); });
  document.querySelectorAll(".reject-booking").forEach(button => { button.onclick = () => updateBookingStatus(button.dataset.id, "rifiutata"); });
  document.querySelectorAll(".cancel-booking").forEach(button => { button.onclick = () => updateBookingStatus(button.dataset.id, "annullata"); });
}

async function loadBookings() {
  if (bookingsLoading) return;
  bookingsLoading = true;
  const { data, error } = await db.from("bar_prenotazioni")
    .select("*,bar_prodotti(nome)")
    .order("data", { ascending: true })
    .order("ora", { ascending: true });

  if (error) {
    $("bar-bookings-body").innerHTML = `<tr><td colspan="8">${esc(error.message)}. Esegui lo script SQL 09 della Versione 6.2.</td></tr>`;
    bookingsLoading = false;
    return;
  }

  loadedBookings = sortBookingsForManagement(data || []);
  renderPendingBookings(loadedBookings);
  renderTodayConfirmed(loadedBookings);

  $("bar-bookings-body").innerHTML = loadedBookings.map(booking => {
    const quantity = Number(booking.quantita_proposte || 1);
    const peopleIncluded = Number(booking.persone_per_proposta_applicate || 1);
    const contactPreference = booking.canale_contatto === "telefono" ? "Preferisce telefonata" : "Preferisce WhatsApp";
    const pastClass = isPastBooking(booking) ? "booking-past" : "";
    return `<tr class="bar-booking-row ${booking.stato === "da_confermare" ? "needs-confirmation" : ""} ${pastClass}">
      <td><strong>${localDate(booking.data)}</strong><br>${String(booking.ora).slice(0, 5)}<br><small>Richiesta ${localDate(String(booking.creato_il).slice(0, 10))}</small></td>
      <td><strong>${esc(booking.bar_prodotti?.nome || "Proposta archiviata")}</strong><br>${quantity} × ${euro(booking.prezzo_unitario_applicato)}<br><strong>Totale ${euro(booking.costo_totale)}</strong><br><small>${peopleIncluded} ${peopleIncluded === 1 ? "persona" : "persone"} per proposta</small></td>
      <td>${esc(booking.nome_cliente)}</td>
      <td><a href="tel:${esc(booking.telefono)}">${esc(booking.telefono)}</a><br><small>${contactPreference}</small></td>
      <td>${booking.persone}</td>
      <td>${esc(booking.note || "—")}</td>
      <td><span class="status-pill ${statusClass(booking.stato)}">${esc(statusLabel(booking.stato))}</span></td>
      <td>${bookingActions(booking)}</td>
    </tr>`;
  }).join("") || '<tr><td colspan="8">Nessuna richiesta aperitivo.</td></tr>';
  attachBookingActions();
  bookingsLoading = false;
}

function printPrivacyNotice() {
  window.open("./privacy.html?origine=bar-gestore&stampa=privacy", "_blank");
}

document.addEventListener("DOMContentLoaded", () => {
  $("bar-login").onclick = login;
  $("bar-login-password").addEventListener("keydown", event => { if (event.key === "Enter") login(); });
  $("bar-logout").onclick = async () => { await db.auth.signOut(); await checkSession(); };
  $("bar-product-form").onsubmit = saveProduct;
  $("bar-product-reset").onclick = resetForm;
  $("bar-refresh-bookings").onclick = loadBookings;
  $("bar-print-privacy").onclick = printPrivacyNotice;
  initializePrintControls();
  checkSession();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !$("bar-dashboard").classList.contains("hidden")) loadBookings();
});
