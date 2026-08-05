const $ = id => document.getElementById(id);

let selectedProduct = null;
let bookingsEnabled = false;
let settingsLoaded = false;
let closureStart = null;
let closureEnd = null;
let closureMessage = "";
let rejectedClosedDate = null;

const BAR_FIRST_TIME = "09:00";
const BAR_LAST_TIME = "21:00";
const BAR_NOTICE_MINUTES = 30;
const BAR_SLOT_MINUTES = 30;
const BAR_TIME_ZONE = window.APP_CONFIG?.WEATHER_TIMEZONE || "Europe/Rome";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function euro(value) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(value || 0));
}

function barClock(referenceDate = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BAR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(referenceDate).reduce((values, part) => {
    if (part.type !== "literal") values[part.type] = part.value;
    return values;
  }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function todayIso(referenceDate = new Date()) {
  return barClock(referenceDate).date;
}

function minutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function firstSameDayTime(referenceDate = new Date()) {
  const currentMinutes = barClock(referenceDate).minutes;
  const requestedMinutes = Math.ceil((currentMinutes + BAR_NOTICE_MINUTES) / BAR_SLOT_MINUTES) * BAR_SLOT_MINUTES;
  const firstMinutes = Math.max(timeToMinutes(BAR_FIRST_TIME), requestedMinutes);
  return firstMinutes <= timeToMinutes(BAR_LAST_TIME) ? minutesToTime(firstMinutes) : null;
}

function fillAvailableTimes(timeInput, firstTime, { resetValue = false } = {}) {
  const previousValue = timeInput.value;
  const firstMinutes = timeToMinutes(firstTime);
  const lastMinutes = timeToMinutes(BAR_LAST_TIME);
  const availableTimes = [];

  for (let minutes = firstMinutes; minutes <= lastMinutes; minutes += BAR_SLOT_MINUTES) {
    availableTimes.push(minutesToTime(minutes));
  }

  timeInput.innerHTML = availableTimes
    .map(time => `<option value="${time}">${time}</option>`)
    .join("");

  const previousMinutes = timeToMinutes(previousValue);
  const previousIsAvailable = !resetValue
    && previousValue
    && previousMinutes >= firstMinutes
    && previousMinutes <= lastMinutes
    && (previousMinutes - firstMinutes) % BAR_SLOT_MINUTES === 0;

  timeInput.value = previousIsAvailable ? previousValue : firstTime;
}

function updateTimeRules({ resetValue = false, announce = false, referenceDate = new Date() } = {}) {
  const dateInput = $("bar-data");
  const timeInput = $("bar-ora");
  const description = $("bar-ora-description");
  if (!dateInput || !timeInput || !description) return true;

  const today = todayIso(referenceDate);
  dateInput.min = today;

  if (dateInput.value === today) {
    const firstTime = firstSameDayTime(referenceDate);
    if (!firstTime) {
      timeInput.innerHTML = '<option value="">Nessun orario disponibile</option>';
      timeInput.value = "";
      timeInput.disabled = true;
      description.textContent = "Per oggi non ci sono più orari disponibili. Scegli una data successiva.";
      if (announce) showMessage("Per oggi non ci sono più orari disponibili. Scegli una data successiva.", "warning");
      updateAvailability();
      return false;
    }

    timeInput.disabled = false;
    fillAvailableTimes(timeInput, firstTime, { resetValue });
    description.textContent = `Per oggi il primo orario disponibile è ${firstTime}, con almeno 30 minuti di anticipo.`;
    updateAvailability();
    return true;
  }

  timeInput.disabled = false;
  fillAvailableTimes(timeInput, BAR_FIRST_TIME, { resetValue });
  description.textContent = "Orari disponibili dalle 09:00 alle 21:00, ogni 30 minuti.";
  updateAvailability();
  return true;
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
  const description = $("bar-data-description");
  description.classList.toggle("date-unavailable", Boolean(rejectedClosedDate));

  if (rejectedClosedDate && closureStart && closureEnd) {
    description.textContent = `Date disabilitate per ferie: dal ${localDate(closureStart)} al ${localDate(closureEnd)}.`;
    return;
  }
  if (value) {
    description.textContent = localDate(value);
    return;
  }
  description.textContent = closureStart && closureEnd
    ? `Ferie: dal ${localDate(closureStart)} al ${localDate(closureEnd)} le date non sono prenotabili.`
    : "";
}

function enforceOpenDate(announce = false) {
  const input = $("bar-data");
  const value = input.value;

  if (!isDateClosed(value)) {
    rejectedClosedDate = null;
    input.setCustomValidity("");
    input.removeAttribute("aria-invalid");
    updateDateDescription();
    return true;
  }

  rejectedClosedDate = value;
  input.value = "";
  input.setCustomValidity("La data scelta rientra nel periodo di ferie.");
  input.setAttribute("aria-invalid", "true");
  updateDateDescription();

  if (announce) {
    showMessage(`Le date dal ${localDate(closureStart)} al ${localDate(closureEnd)} sono disabilitate per ferie. Scegli un altro giorno.`, "warning");
  }
  return false;
}

function selectedCalculation() {
  if (!selectedProduct) return null;
  const enteredPeople = Number($("bar-persone").value);
  const people = Number.isInteger(enteredPeople) ? Math.max(0, Math.min(30, enteredPeople)) : 0;
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

  $("bar-selected-product").innerHTML = `
    <strong>${esc(selectedProduct.nome)}</strong>
    <span>${euro(calculation.unitPrice)} per ${groupLabel}</span>
  `;

  if (calculation.people === 0) {
    summary.textContent = "Inserisci il numero di persone per visualizzare il costo.";
    return;
  }

  const quantityLabel = calculation.quantity === 1 ? "1 proposta" : `${calculation.quantity} proposte`;
  summary.innerHTML = `
    <span>Per <strong>${calculation.people} ${calculation.people === 1 ? "persona" : "persone"}</strong> servono ${quantityLabel}.</span>
    <strong class="bar-total-price">Totale previsto: ${euro(calculation.total)}</strong>
    <small>Il totale resta da confermare dal gestore.</small>
  `;
}

function updateAvailability() {
  const date = $("bar-data").value;
  const dateUnavailable = Boolean(rejectedClosedDate) || isDateClosed(date);
  const noTimeAvailable = date === todayIso() && !firstSameDayTime();
  const closed = !settingsLoaded || !bookingsEnabled || !date || dateUnavailable || noTimeAvailable;
  const closureBox = $("bar-closure-box");
  const closureText = $("bar-closure-message");

  if (!settingsLoaded) {
    closureBox.classList.remove("hidden");
    closureText.textContent = "Caricamento delle regole di prenotazione…";
  } else if (!bookingsEnabled) {
    closureBox.classList.remove("hidden");
    closureText.textContent = closureMessage || "Le prenotazioni sono temporaneamente sospese.";
  } else if (dateUnavailable) {
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
  enforceOpenDate(false);
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
  if (!updateTimeRules()) return;

  const enteredPeople = Number($("bar-persone").value);
  if (!Number.isInteger(enteredPeople) || enteredPeople < 1 || enteredPeople > 30) {
    $("bar-persone").focus();
    return showMessage("Inserisci il numero di persone, da 1 a 30.", "error");
  }

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
  if (payload.ora < BAR_FIRST_TIME || payload.ora > BAR_LAST_TIME) return showMessage("Scegli un orario compreso tra le 09:00 e le 21:00.", "error");
  if (!/^3\d{2} \d{3} \d{4}$/.test(payload.telefono)) return showMessage("Inserisci un cellulare italiano valido, ad esempio 328 673 9425.", "error");
  if (payload.data < todayIso()) return showMessage("Non puoi scegliere una data già trascorsa.", "error");
  if (payload.data === todayIso()) {
    const firstTime = firstSameDayTime();
    if (!firstTime) return showMessage("Per oggi non ci sono più orari disponibili. Scegli una data successiva.", "warning");
    if (payload.ora < firstTime) {
      $("bar-ora").value = firstTime;
      return showMessage(`Per oggi non puoi scegliere un orario precedente alle ${firstTime}.`, "warning");
    }
  }
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
    if (message.includes("ORARIO_NON_VALIDO")) return showMessage("L’orario deve essere compreso tra le 09:00 e le 21:00.", "warning");
    if (message.includes("PRODOTTO_NON_DISPONIBILE")) {
      await loadProducts();
      return showMessage("La proposta non è più disponibile. Scegline un’altra.", "error");
    }
    return showMessage(`Richiesta non riuscita: ${message}`, "error");
  }

  const channel = payload.canale_contatto === "telefono" ? "telefonata" : "WhatsApp";
  showMessage(`Richiesta inviata: ${calculation.quantity} ${calculation.quantity === 1 ? "proposta" : "proposte"}, totale previsto ${euro(calculation.total)}. Il gestore ti contatterà tramite ${channel} al ${payload.telefono} per confermarla.`, "success");
  ["bar-nome", "bar-telefono", "bar-note"].forEach(id => { $(id).value = ""; });
  $("bar-persone").value = "0";
  $("bar-privacy").checked = false;
  $("bar-data").value = todayIso();
  updateTimeRules({ resetValue: true });
  updateDateDescription();
  updateCalculation();
  updateAvailability();
}

document.addEventListener("DOMContentLoaded", async () => {
  $("bar-data").value = todayIso();
  updateTimeRules({ resetValue: true });
  updateDateDescription();
  updateCalculation();
  updateAvailability();

  $("bar-data").addEventListener("change", () => {
    clearMessage();
    enforceOpenDate(true);
    updateTimeRules({ resetValue: true, announce: true });
    updateAvailability();
  });
  $("bar-ora").addEventListener("change", () => updateTimeRules());
  $("bar-persone").addEventListener("input", updateCalculation);
  $("bar-telefono").addEventListener("blur", event => { event.target.value = formatPhone(event.target.value); });
  $("bar-prenota").addEventListener("click", book);
  $("bar-apri-privacy").addEventListener("click", openPrivacy);
  $("bar-chiudi-privacy").addEventListener("click", closePrivacy);
  $("bar-torna-prenotazione").addEventListener("click", closePrivacy);

  await Promise.all([loadSettings(), loadProducts()]);

  window.setInterval(() => {
    const previousToday = $("bar-data").min;
    const currentToday = todayIso();
    if ($("bar-data").value === previousToday && previousToday !== currentToday) {
      $("bar-data").value = currentToday;
    }
    updateTimeRules();
  }, 60_000);
});
