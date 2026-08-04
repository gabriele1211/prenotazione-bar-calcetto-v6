const $ = id => document.getElementById(id);

let selectedProduct = null;
let bookingsEnabled = false;
let settingsLoaded = false;
let closureStart = null;
let closureEnd = null;
let closureMessage = "";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function euro(value) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(value || 0));
}

function todayIso() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function localDate(value) {
  if (!value) return "";
  return new Date(`${value}T12:00:00`).toLocaleDateString("it-IT", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
}

function showMessage(text, type = "success") {
  const box = $("bar-message");
  box.textContent = text;
  box.className = `message show ${type}`;
}

function clearMessage() {
  const box = $("bar-message");
  box.textContent = "";
  box.className = "message";
}

function formatPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("39") && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 10) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return String(value || "").trim();
}

function isDateClosed(value) {
  return Boolean(value && closureStart && closureEnd && value >= closureStart && value <= closureEnd);
}

function updateDateDescription() {
  const value = $("bar-data").value;
  $("bar-data-description").textContent = value ? localDate(value) : "";
}

function selectedCalculation() {
  if (!selectedProduct) return null;
  const people = Math.max(1, Math.min(30, Number($("bar-persone").value || 1)));
  const peopleIncluded = Math.max(1, Number(selectedProduct.persone_incluse || 1));
  const quantity = Math.ceil(people / peopleIncluded);
  const unitPrice = Number(selectedProduct.prezzo || 0);
  return { people, peopleIncluded, quantity, unitPrice, total: quantity * unitPrice };
}

function updateCalculation() {
  const summary = $("bar-cost-summary");
  if (!selectedProduct) {
    summary.textContent = "Seleziona una proposta per visualizzare il costo.";
    $("bar-selected-product").textContent = "Nessuna proposta selezionata.";
    return;
  }

  const calculation = selectedCalculation();
  const groupLabel = calculation.peopleIncluded === 1 ? "1 persona" : `${calculation.peopleIncluded} persone`;
  const quantityLabel = calculation.quantity === 1 ? "1 proposta" : `${calculation.quantity} proposte`;

  $("bar-selected-product").innerHTML = `
    <strong>${esc(selectedProduct.nome)}</strong>
    <span>${euro(calculation.unitPrice)} per ${groupLabel}</span>
  `;
  summary.innerHTML = `
    <span>Per <strong>${calculation.people} ${calculation.people === 1 ? "persona" : "persone"}</strong> servono ${quantityLabel}.</span>
    <strong class="bar-total-price">Totale previsto: ${euro(calculation.total)}</strong>
    <small>Il totale resta da confermare dal gestore.</small>
  `;
}

function updateAvailability() {
  const date = $("bar-data").value;
  const closed = !settingsLoaded || !bookingsEnabled || isDateClosed(date);
  const closureBox = $("bar-closure-box");
  const closureText = $("bar-closure-message");

  if (!settingsLoaded) {
    closureBox.classList.remove("hidden");
    closureText.textContent = "Caricamento delle regole di prenotazione…";
  } else if (!bookingsEnabled) {
    closureBox.classList.remove("hidden");
    closureText.textContent = closureMessage || "Le prenotazioni sono temporaneamente sospese.";
  } else if (isDateClosed(date)) {
    closureBox.classList.remove("hidden");
    closureText.textContent = closureMessage || `Chiuso per ferie dal ${localDate(closureStart)} al ${localDate(closureEnd)}.`;
  } else {
    closureBox.classList.add("hidden");
  }

  $("bar-prenota").disabled = closed;
}

async function loadSettings() {
  const { data, error } = await db.from("impostazioni_prenotazioni")
    .select("prenotazioni_attive,chiusura_dal,chiusura_al,messaggio_chiusura")
    .eq("id", 1)
    .maybeSingle();

  settingsLoaded = true;
  if (error || !data) {
    bookingsEnabled = false;
    closureMessage = "Impossibile verificare le regole di apertura. Riprova tra poco.";
  } else {
    bookingsEnabled = data.prenotazioni_attive !== false;
    closureStart = data.chiusura_dal || null;
    closureEnd = data.chiusura_al || null;
    closureMessage = data.messaggio_chiusura || "";
  }
  updateAvailability();
}

async function loadProducts() {
  const box = $("bar-products");
  const { data, error } = await db.from("bar_prodotti")
    .select("id,nome,descrizione,prezzo,immagine_url,ordine,persone_incluse")
    .eq("attivo", true)
    .order("ordine")
    .order("creato_il");

  if (error) {
    box.innerHTML = '<p class="field-error">Impossibile caricare le proposte. Esegui lo script SQL 09 della Versione 6.2.</p>';
    return;
  }
  if (!data?.length) {
    box.innerHTML = "<p>Nessuna proposta disponibile al momento.</p>";
    return;
  }

  box.innerHTML = data.map(product => {
    const peopleIncluded = Math.max(1, Number(product.persone_incluse || 1));
    const peopleLabel = peopleIncluded === 1 ? "1 persona" : `${peopleIncluded} persone`;
    return `<article class="bar-product-card" data-id="${product.id}">
      <div class="bar-product-image">${product.immagine_url ? `<img src="${esc(product.immagine_url)}" alt="${esc(product.nome)}">` : "<span>🍹</span>"}</div>
      <div class="bar-product-body">
        <h3>${esc(product.nome)}</h3>
        <p>${esc(product.descrizione || "")}</p>
        <div class="bar-product-price"><strong>${euro(product.prezzo)}</strong><small>per ${peopleLabel}</small></div>
        <button class="primary bar-select-product" data-id="${product.id}" type="button">Scegli e calcola</button>
      </div>
    </article>`;
  }).join("");

  box.querySelectorAll(".bar-select-product").forEach(button => button.addEventListener("click", () => {
    selectedProduct = data.find(product => product.id === button.dataset.id) || null;
    box.querySelectorAll(".bar-product-card").forEach(card => card.classList.toggle("selected", card.dataset.id === button.dataset.id));
    updateCalculation();
    $("bar-booking-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

function openPrivacy(event) {
  event.preventDefault();
  const dialog = $("bar-privacy-dialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
}

function closePrivacy() {
  $("bar-privacy-dialog")?.close();
}

async function book() {
  clearMessage();
  if (!selectedProduct) return showMessage("Seleziona prima un aperitivo o un tagliere.", "error");
  if (!settingsLoaded || !bookingsEnabled) return showMessage(closureMessage || "Le richieste sono temporaneamente sospese.", "warning");
  if (isDateClosed($("bar-data").value)) return showMessage(closureMessage || "La data scelta non è disponibile per chiusura.", "warning");

  const calculation = selectedCalculation();
  const phone = formatPhone($("bar-telefono").value);
  $("bar-telefono").value = phone;
  const payload = {
    prodotto_id: selectedProduct.id,
    nome_cliente: $("bar-nome").value.trim(),
    telefono: phone,
    persone: calculation.people,
    data: $("bar-data").value,
    ora: $("bar-ora").value,
    canale_contatto: $("bar-canale-contatto").value,
    note: $("bar-note").value.trim() || null
  };

  if (!payload.nome_cliente || !payload.telefono || !payload.data || !payload.ora) return showMessage("Compila tutti i campi obbligatori.", "error");
  if (!/^3\d{2} \d{3} \d{4}$/.test(payload.telefono)) return showMessage("Inserisci un cellulare italiano valido, ad esempio 328 673 9425.", "error");
  if (payload.data < todayIso()) return showMessage("Non puoi scegliere una data già trascorsa.", "error");
  if (!$("bar-privacy").checked) return showMessage("Devi leggere e accettare l’informativa privacy.", "error");

  const button = $("bar-prenota");
  button.disabled = true;
  button.textContent = "Invio in corso…";
  const { error } = await db.from("bar_prenotazioni").insert(payload);
  button.textContent = "Invia richiesta aperitivo";
  updateAvailability();

  if (error) {
    const message = String(error.message || "");
    if (message.includes("APERITIVI_SOSPESI")) return showMessage(closureMessage || "La data scelta non è disponibile per chiusura.", "warning");
    if (message.includes("PRODOTTO_NON_DISPONIBILE")) {
      await loadProducts();
      return showMessage("La proposta non è più disponibile. Scegline un’altra.", "error");
    }
    return showMessage(`Richiesta non riuscita: ${message}`, "error");
  }

  const channel = payload.canale_contatto === "telefono" ? "telefonata" : "WhatsApp";
  showMessage(`Richiesta inviata: ${calculation.quantity} ${calculation.quantity === 1 ? "proposta" : "proposte"}, totale previsto ${euro(calculation.total)}. Il gestore ti contatterà tramite ${channel} al ${payload.telefono} per confermarla.`, "success");
  ["bar-nome", "bar-telefono", "bar-note"].forEach(id => { $(id).value = ""; });
  $("bar-privacy").checked = false;
  $("bar-data").value = todayIso();
  updateDateDescription();
  updateAvailability();
}

document.addEventListener("DOMContentLoaded", async () => {
  $("bar-data").min = todayIso();
  $("bar-data").value = todayIso();
  updateDateDescription();
  updateCalculation();
  updateAvailability();

  $("bar-data").addEventListener("change", () => {
    updateDateDescription();
    clearMessage();
    updateAvailability();
  });
  $("bar-persone").addEventListener("input", updateCalculation);
  $("bar-telefono").addEventListener("blur", event => { event.target.value = formatPhone(event.target.value); });
  $("bar-prenota").addEventListener("click", book);
  $("bar-apri-privacy").addEventListener("click", openPrivacy);
  $("bar-chiudi-privacy").addEventListener("click", closePrivacy);
  $("bar-torna-prenotazione").addEventListener("click", closePrivacy);

  await Promise.all([loadSettings(), loadProducts()]);
});
