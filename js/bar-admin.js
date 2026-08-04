const $ = id => document.getElementById(id);
let products = [];

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
  if (authenticated) await Promise.all([loadProducts(), loadBookings(), loadClosureSummary()]);
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

function contactActions(booking) {
  const number = whatsappNumber(booking.telefono);
  const quantity = Number(booking.quantita_proposte || 1);
  const text = `Ciao ${booking.nome_cliente}, ti contattiamo dal Bar Parco Ex Velodromo per la richiesta del ${localDate(booking.data)} alle ${String(booking.ora).slice(0, 5)}: ${quantity} ${quantity === 1 ? "proposta" : "proposte"} ${booking.bar_prodotti?.nome || "aperitivo"}, totale ${euro(booking.costo_totale)}. La prenotazione è confermata.`;
  return `<div class="bar-contact-actions">
    <a class="bar-action-link whatsapp" href="https://wa.me/${number}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp</a>
    <a class="bar-action-link phone" href="tel:+${number}">Chiama</a>
  </div>`;
}

function bookingActions(booking) {
  const contact = contactActions(booking);
  if (booking.stato === "da_confermare") {
    return `${contact}<div class="bar-decision-actions">
      <button class="primary confirm-booking" data-id="${booking.id}" type="button">Conferma</button>
      <button class="danger reject-booking" data-id="${booking.id}" type="button">Rifiuta</button>
    </div>`;
  }
  if (booking.stato === "confermata") {
    return `${contact}<button class="secondary cancel-booking" data-id="${booking.id}" type="button">Annulla</button>`;
  }
  return contact;
}

async function updateBookingStatus(id, status) {
  const labels = { confermata: "confermare", rifiutata: "rifiutare", annullata: "annullare" };
  if (!confirm(`Vuoi ${labels[status]} questa richiesta?`)) return;
  const { error } = await db.from("bar_prenotazioni").update({
    stato: status,
    aggiornato_il: new Date().toISOString()
  }).eq("id", id);
  if (error) return message(`Aggiornamento non riuscito: ${error.message}`, "error");
  await loadBookings();
}

function attachBookingActions() {
  document.querySelectorAll(".confirm-booking").forEach(button => { button.onclick = () => updateBookingStatus(button.dataset.id, "confermata"); });
  document.querySelectorAll(".reject-booking").forEach(button => { button.onclick = () => updateBookingStatus(button.dataset.id, "rifiutata"); });
  document.querySelectorAll(".cancel-booking").forEach(button => { button.onclick = () => updateBookingStatus(button.dataset.id, "annullata"); });
}

async function loadBookings() {
  const { data, error } = await db.from("bar_prenotazioni")
    .select("*,bar_prodotti(nome)")
    .order("data", { ascending: false })
    .order("ora", { ascending: false });

  if (error) {
    $("bar-bookings-body").innerHTML = `<tr><td colspan="8">${esc(error.message)}. Esegui lo script SQL 09 della Versione 6.2.</td></tr>`;
    return;
  }

  $("bar-bookings-body").innerHTML = (data || []).map(booking => {
    const quantity = Number(booking.quantita_proposte || 1);
    const peopleIncluded = Number(booking.persone_per_proposta_applicate || 1);
    const contactPreference = booking.canale_contatto === "telefono" ? "Preferisce telefonata" : "Preferisce WhatsApp";
    return `<tr class="bar-booking-row ${booking.stato === "da_confermare" ? "needs-confirmation" : ""}">
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
  checkSession();
});
