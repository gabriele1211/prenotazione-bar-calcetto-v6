const $ = (id) => document.getElementById(id);
const dataInput = $("data");
const campoSelect = $("campo");
const slotsBox = $("slots");
const selectedText = $("slot-selezionato");
const messageBox = $("messaggio");
const prenotaButton = $("prenota");

let selectedStart = null;
let selectedEnd = null;
let fields = [];
let bookingsEnabled = true;
let closureStart = null;
let closureEnd = null;
let closureMessage = "";
let halfFieldEnabled = false;
let maxChildrenHalfField = 6;
let fullFieldPrice = 0;
let halfFieldPrice = 0;
let selectedBookingType = "INTERO";
let italianMunicipalities = new Map();
let italianMunicipalityNames = [];
let municipalitiesReady = false;
let municipalitySelectionConfirmed = false;
let weatherSelectionToken = 0;
const BOOKING_DRAFT_KEY = "orione-booking-draft-v525";
const LEGACY_BOOKING_DRAFT_KEYS = [
  "orione-booking-draft-v524",
  "orione-booking-draft-v523",
  "orione-booking-draft-v522",
  "orione-booking-draft-v520"
];
let restoringBookingDraft = false;


function hideSelectedWeather() {
  weatherSelectionToken += 1;
  const box = $("meteo-prenotazione");
  if (!box) return;
  box.classList.add("hidden");
  box.innerHTML = "";
}

async function showSelectedWeather(date, startTime) {
  const box = $("meteo-prenotazione");
  if (!box || !window.WeatherService) return;
  const token = ++weatherSelectionToken;
  box.classList.remove("hidden");
  box.innerHTML = '<div class="weather-card weather-loading">🌦️ Caricamento previsione meteo…</div>';
  try {
    const weather = await WeatherService.getForBooking(date, startTime);
    if (token !== weatherSelectionToken) return;
    box.innerHTML = WeatherService.detailedHtml(weather);
  } catch (error) {
    console.error("Errore meteo:", error);
    if (token !== weatherSelectionToken) return;
    box.innerHTML = '<div class="weather-card weather-unknown"><strong>🌦️ Meteo momentaneamente non disponibile</strong><span>La prenotazione può comunque essere effettuata.</span></div>';
  }
}


function getValue(id) {
  return $(id)?.value ?? "";
}

function setValue(id, value) {
  const element = $(id);
  if (!element) return;
  element.value = value ?? "";
}

function bookingDraftPayload() {
  return {
    savedAt: Date.now(),
    campo: campoSelect.value,
    tipoPrenotazione: selectedBookingType,
    selectedStart,
    selectedEnd,
    nome: getValue("nome"),
    telefono: getValue("telefono"),
    documentoNumero: getValue("documento-numero"),
    documentoDataRilascio: getValue("documento-data-rilascio"),
    documentoRilasciatoDa: getValue("documento-rilasciato-da"),
    note: getValue("note"),
    numeroBambini: getValue("numero-bambini"),
    municipalitySelectionConfirmed
  };
}

function saveBookingDraft() {
  if (restoringBookingDraft) return;
  const serializedDraft = JSON.stringify(bookingDraftPayload());

  // Su iOS la sessione della PWA può essere ricreata passando a una pagina
  // interna. Manteniamo quindi anche una copia locale temporanea, eliminata
  // dopo la prenotazione o alla scadenza della bozza.
  try { sessionStorage.setItem(BOOKING_DRAFT_KEY, serializedDraft); } catch (_) {}
  try { localStorage.setItem(BOOKING_DRAFT_KEY, serializedDraft); } catch (_) {}
}

function readStorage(storage, key) {
  try { return storage.getItem(key); } catch (_) { return null; }
}

function readBookingDraft() {
  try {
    // iOS può ripristinare una sessionStorage più vecchia della copia in
    // localStorage. Leggiamo tutte le copie disponibili e scegliamo quella
    // salvata più di recente, invece di privilegiare la sessione.
    const candidates = [];
    const keys = [BOOKING_DRAFT_KEY, ...LEGACY_BOOKING_DRAFT_KEYS];
    for (const key of keys) {
      for (const storage of [sessionStorage, localStorage]) {
        const serializedDraft = readStorage(storage, key);
        if (!serializedDraft) continue;
        try {
          const candidate = JSON.parse(serializedDraft);
          if (candidate?.savedAt) candidates.push(candidate);
        } catch (_) {}
      }
    }

    const draft = candidates.sort((a, b) => Number(b.savedAt) - Number(a.savedAt))[0] || null;
    if (!draft?.savedAt) return null;
    if (Date.now() - draft.savedAt > 12 * 60 * 60 * 1000) {
      clearBookingDraft();
      return null;
    }
    return draft;
  } catch (_) {
    return null;
  }
}

function clearBookingDraft() {
  const keys = [BOOKING_DRAFT_KEY, ...LEGACY_BOOKING_DRAFT_KEYS];
  for (const key of keys) {
    try { sessionStorage.removeItem(key); } catch (_) {}
    try { localStorage.removeItem(key); } catch (_) {}
  }
}

function applyBookingDraftFields(draft) {
  if (!draft) return;

  setValue("nome", draft.nome);
  setValue("telefono", draft.telefono);
  setValue("documento-numero", draft.documentoNumero);
  setValue("documento-data-rilascio", draft.documentoDataRilascio);
  setValue("documento-rilasciato-da", draft.documentoRilasciatoDa);
  setValue("note", draft.note);
  setValue("numero-bambini", draft.numeroBambini);
}

function restoreBookingDraftFieldsImmediately() {
  const draft = readBookingDraft();
  if (!draft) return null;

  restoringBookingDraft = true;
  try {
    applyBookingDraftFields(draft);
  } finally {
    restoringBookingDraft = false;
  }
  return draft;
}

async function restoreBookingDraft() {
  const draft = readBookingDraft();
  if (!draft) return;

  restoringBookingDraft = true;
  try {
    applyBookingDraftFields(draft);

    if (
      draft.campo &&
      [...campoSelect.options].some(option => option.value === draft.campo)
    ) {
      campoSelect.value = draft.campo;
    }

    const requestedType =
      draft.tipoPrenotazione === "MEZZO" && halfFieldEnabled
        ? "MEZZO"
        : "INTERO";

    const requestedRadio = document.querySelector(
      `input[name="tipo-prenotazione"][value="${requestedType}"]`
    );
    if (requestedRadio) requestedRadio.checked = true;
    updateBookingModeUi();

    const municipality = String(draft.documentoRilasciatoDa || "");
    municipalitySelectionConfirmed =
      Boolean(draft.municipalitySelectionConfirmed) ||
      italianMunicipalities.has(normalizeSearchText(municipality));

    await loadSlots();

    if (draft.selectedStart) {
      const slotButton = [...slotsBox.querySelectorAll("button.slot:not(:disabled)")].find(
        button =>
          button.querySelector(".slot-time")?.textContent?.startsWith(draft.selectedStart)
      );
      slotButton?.click();
    }
  } finally {
    restoringBookingDraft = false;
  }
}

function normalizeSearchText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleUpperCase("it-IT");
}

function extractMunicipalityNames(payload) {
  const names = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const candidate = value.nome ?? value.comune ?? value.denominazione ?? value.name;
    if (typeof candidate === "string" && candidate.trim().length > 1) names.push(candidate.trim());
    Object.values(value).forEach(child => {
      if (child && typeof child === "object") visit(child);
    });
  };
  visit(payload);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, "it"));
}

async function loadItalianMunicipalities() {
  const status = $("comuni-status");
  try {
    const cached = localStorage.getItem("v401-comuni-italiani");
    let names = cached ? JSON.parse(cached) : null;
    if (!Array.isArray(names) || names.length < 7000) {
      const response = await fetch("https://raw.githubusercontent.com/AndreaGrandieri/Comuni-Italia/main/comuni.json", { cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      names = extractMunicipalityNames(await response.json());
      if (names.length < 7000) throw new Error("Elenco Comuni incompleto");
      try { localStorage.setItem("v401-comuni-italiani", JSON.stringify(names)); } catch (_) {}
    }
    italianMunicipalityNames = names;
    italianMunicipalities = new Map(names.map(name => [normalizeSearchText(name), name]));
    municipalitiesReady = true;
    status.textContent = "Seleziona un Comune presente nell’elenco.";
    status.classList.remove("field-error");
  } catch (error) {
    municipalitiesReady = false;
    status.textContent = "Elenco Comuni non disponibile: aggiorna la pagina prima di prenotare.";
    status.classList.add("field-error");
  }
}


function closeMunicipalitySuggestions() {
  const box = $("comuni-suggerimenti");
  const input = $("documento-rilasciato-da");
  box.classList.add("hidden");
  box.innerHTML = "";
  input.setAttribute("aria-expanded", "false");
}

function selectMunicipality(name) {
  const input = $("documento-rilasciato-da");
  input.value = name;
  municipalitySelectionConfirmed = true;
  closeMunicipalitySuggestions();
  $("comuni-status").textContent = `Comune selezionato: ${name}`;
  $("comuni-status").classList.remove("field-error");
}

function updateMunicipalitySuggestions() {
  const input = $("documento-rilasciato-da");
  const box = $("comuni-suggerimenti");
  const query = normalizeSearchText(input.value);
  municipalitySelectionConfirmed = italianMunicipalities.has(query);

  if (!municipalitiesReady || query.length < 2) {
    closeMunicipalitySuggestions();
    return;
  }

  const starts = [];
  const contains = [];
  for (const name of italianMunicipalityNames) {
    const normalized = normalizeSearchText(name);
    if (normalized.startsWith(query)) starts.push(name);
    else if (normalized.includes(query)) contains.push(name);
  }
  const matches = [...starts, ...contains].slice(0, 12);
  if (!matches.length) {
    box.innerHTML = '<div class="municipality-empty">Nessun Comune trovato.</div>';
  } else {
    box.innerHTML = "";
    matches.forEach(name => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "municipality-option";
      button.setAttribute("role", "option");
      button.textContent = name;
      button.addEventListener("pointerdown", event => {
        event.preventDefault();
        selectMunicipality(name);
      });
      box.appendChild(button);
    });
  }
  box.classList.remove("hidden");
  input.setAttribute("aria-expanded", "true");
}

function validateIdentityCardNumber(value) {
  const normalized = normalizeDocument(value);
  // Carta d’Identità Elettronica (CIE): 2 lettere + 5 cifre + 2 lettere.
  return /^[A-Z]{2}\d{5}[A-Z]{2}$/.test(normalized);
}

function validateMunicipality(value) {
  if (!municipalitiesReady) return false;
  return municipalitySelectionConfirmed && italianMunicipalities.has(normalizeSearchText(value));
}



function capitalizeFirst(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function isoToLocalDate(isoDate) {
  const [year, month, day] = String(isoDate || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function dateDiffInDays(fromDate, toDate) {
  const fromUtc = Date.UTC(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const toUtc = Date.UTC(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  return Math.round((toUtc - fromUtc) / 86400000);
}

function updateDateDescription() {
  const target = $("data-descrizione");
  if (!target) return;

  const selected = isoToLocalDate(dataInput.value);
  if (!selected) {
    target.textContent = "";
    return;
  }

  const today = isoToLocalDate(localTodayIso());
  const difference = dateDiffInDays(today, selected);
  const dayName = capitalizeFirst(
    new Intl.DateTimeFormat("it-IT", { weekday: "long" }).format(selected)
  );
  const fullDate = new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(selected);

  let relativeLabel = "";
  if (difference === 0) relativeLabel = "Oggi";
  else if (difference === 1) relativeLabel = "Domani";

  target.textContent = relativeLabel
    ? `${relativeLabel} (${dayName}) ${fullDate}`
    : `${dayName} ${fullDate}`;
}

function localTodayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function showMessage(text, type = "warning", allowHtml = false) {
  if (allowHtml) messageBox.innerHTML = text;
  else messageBox.textContent = text;
  messageBox.className = `message show ${type}`;
  messageBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearMessage() {
  messageBox.textContent = "";
  messageBox.className = "message";
}

function minutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatDateItalian(isoDate) {
  return new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
    .format(new Date(`${isoDate}T12:00:00`));
}

function normalizeDocument(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatPersonName(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("it-IT")
    .replace(/\s+/g, " ")
    .replace(/(^|[\s'’\-])([a-zà-öø-ÿ])/giu, (_, separator, letter) =>
      separator + letter.toLocaleUpperCase("it-IT")
    );
}

function formatPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("0039")) digits = digits.slice(4);
  else if (digits.startsWith("39") && digits.length > 10) digits = digits.slice(2);

  if (/^3\d{9}$/.test(digits)) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return digits;
}

function isDateClosed(isoDate) {
  return Boolean(isoDate && closureStart && closureEnd && isoDate >= closureStart && isoDate <= closureEnd);
}

function updateClosureNotice(isoDate) {
  const closureBox = $("chiusura-box");
  const closureText = $("chiusura-messaggio");

  if (!bookingsEnabled) {
    closureBox.classList.remove("hidden");
    closureText.textContent = closureMessage || "Il servizio di prenotazione è temporaneamente sospeso.";
    prenotaButton.disabled = true;
    return true;
  }

  if (isDateClosed(isoDate)) {
    closureBox.classList.remove("hidden");
    closureText.textContent = closureMessage || `Il campo è chiuso dal ${closureStart} al ${closureEnd}.`;
    prenotaButton.disabled = true;
    return true;
  }

  closureBox.classList.add("hidden");
  closureText.textContent = "";
  prenotaButton.disabled = false;
  return false;
}



function isPaidTimeSlot(startTime) {
  const hour = Number(String(startTime || "00:00").slice(0, 2));
  return hour >= 19 && hour < 22;
}

function bookingPriceForSlot(startTime, bookingType) {
  if (!isPaidTimeSlot(startTime)) return 0;
  return bookingType === "MEZZO" ? halfFieldPrice : fullFieldPrice;
}



function bookingPriceLabel(startTime, bookingType) {
  const amount = bookingPriceForSlot(startTime, bookingType);
  return amount > 0 ? euroLabel(amount) : "Gratuito";
}

function euroLabel(value) {
  const amount = Number(value || 0);
  return amount > 0
    ? new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(amount)
    : "Gratuito";
}

function selectedType() {
  return document.querySelector('input[name="tipo-prenotazione"]:checked')?.value || "INTERO";
}

function updateBookingModeUi() {
  selectedBookingType = halfFieldEnabled ? selectedType() : "INTERO";
  const childrenBox = $("bambini-box");
  const childrenInput = $("numero-bambini");
  const isHalf = halfFieldEnabled && selectedBookingType === "MEZZO";
  childrenBox.classList.toggle("hidden", !isHalf);
  childrenInput.required = isHalf;
  childrenInput.max = String(maxChildrenHalfField);
  $("bambini-help").textContent = `Massimo ${maxChildrenHalfField} bambini per metà campo.`;
  $("prezzo-intero-label").textContent = "Utilizzo dell’intero campo";
  $("prezzo-mezzo-label").textContent = "Per attività con bambini e adulto responsabile";
}

function groupPlanningByStart(planning) {
  const grouped = new Map();
  for (const booking of planning || []) {
    const key = String(booking.ora_inizio).slice(0, 5);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(booking);
  }
  return grouped;
}

function slotAvailability(bookings, requestedType) {
  const active = (bookings || []).filter(b => b.stato !== "annullata");
  const whole = active.find(b => (b.settore || "INTERO") === "INTERO");
  const halves = active.filter(b => ["A", "B"].includes(b.settore));

  if (whole) return { available: false, label: "Campo intero prenotato", customer: whole.nome_pubblico || "Occupato" };
  if (requestedType === "INTERO") {
    if (halves.length) return { available: false, label: halves.length === 2 ? "Entrambe le metà prenotate" : "Una metà già prenotata", customer: halves.map(x => x.nome_pubblico).filter(Boolean).join(" · ") };
    return { available: true, label: "Campo intero libero" };
  }

  if (halves.length >= 2) return { available: false, label: "Entrambe le metà prenotate", customer: halves.map(x => x.nome_pubblico).filter(Boolean).join(" · ") };
  return { available: true, label: halves.length === 1 ? "1 metà disponibile" : "2 metà disponibili" };
}

async function loadBookingStatus() {
  const { data, error } = await db.from("impostazioni_prenotazioni")
    .select("prenotazioni_attive,chiusura_dal,chiusura_al,messaggio_chiusura,mezzo_campo_attivo,max_bambini_mezzo_campo,prezzo_campo_intero,prezzo_mezzo_campo")
    .eq("id", 1).maybeSingle();
  if (error || !data) return;

  bookingsEnabled = Boolean(data.prenotazioni_attive);
  closureStart = data.chiusura_dal || null;
  closureEnd = data.chiusura_al || null;
  closureMessage = data.messaggio_chiusura || "";
  halfFieldEnabled = Boolean(data.mezzo_campo_attivo);
  maxChildrenHalfField = Math.max(1, Number(data.max_bambini_mezzo_campo || 6));
  fullFieldPrice = Number(data.prezzo_campo_intero || 0);
  halfFieldPrice = Number(data.prezzo_mezzo_campo || 0);

  $("tipo-prenotazione-box").classList.toggle("hidden", !halfFieldEnabled);
  if (!halfFieldEnabled) {
    const fullRadio = document.querySelector('input[name="tipo-prenotazione"][value="INTERO"]');
    if (fullRadio) fullRadio.checked = true;
  }
  updateBookingModeUi();
  updateClosureNotice(dataInput.value);
}

async function loadFields() {
  const { data, error } = await db.from("campi").select("id,nome,attivo").eq("attivo", true).order("nome");
  if (error) return showMessage("Impossibile caricare i campi: " + error.message, "error");
  fields = data || [];
  campoSelect.innerHTML = fields.map(campo => `<option value="${campo.id}">${campo.nome}</option>`).join("");
  await loadSlots();
}

async function loadSlots(options = {}) {
  if (!options.preserveMessage) clearMessage();
  selectedStart = selectedEnd = null;
  selectedText.textContent = "Nessun orario selezionato.";
  hideSelectedWeather();
  slotsBox.innerHTML = "<p>Caricamento disponibilità...</p>";
  const bookingDate = dataInput.value;
  const fieldId = campoSelect.value;
  if (!bookingDate || !fieldId) return;

  const dateUnavailable = updateClosureNotice(bookingDate);
  if (dateUnavailable) {
    const start = APP_CONFIG.OPENING_HOUR * 60;
    const end = APP_CONFIG.CLOSING_HOUR * 60;
    const duration = APP_CONFIG.DEFAULT_FIELD_DURATION_MINUTES;
    slotsBox.innerHTML = "";
    for (let min = start; min + duration <= end; min += duration) {
      const slotStart = minutesToTime(min);
      const slotEnd = minutesToTime(min + duration);
      const paid = min >= APP_CONFIG.PAID_FROM_HOUR * 60;
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = true;
      button.className = `slot past ${paid ? "paid-slot" : "free-slot"}`;
      button.innerHTML = `<span class="slot-time">${slotStart}–${slotEnd}</span><span class="slot-price">${paid ? "A pagamento" : "Gratuito"}</span><span class="slot-status">Non disponibile</span>`;
      slotsBox.appendChild(button);
    }
    selectedText.textContent = "Data non disponibile per chiusura.";
    return;
  }

  const { data: planning, error } = await db.rpc("get_daily_planning_v4_1", { p_campo_id: fieldId, p_data: bookingDate });
  if (error) {
    slotsBox.innerHTML = "";
    return showMessage("Errore nella lettura del planning: " + error.message, "error");
  }

  const bookingsByStart = groupPlanningByStart(planning);
  const start = APP_CONFIG.OPENING_HOUR * 60;
  const end = APP_CONFIG.CLOSING_HOUR * 60;
  const duration = APP_CONFIG.DEFAULT_FIELD_DURATION_MINUTES;
  const now = new Date();
  const today = localTodayIso();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  slotsBox.innerHTML = "";

  for (let min = start; min + duration <= end; min += duration) {
    const slotStart = minutesToTime(min);
    const slotEnd = minutesToTime(min + duration);
    const slotBookings = bookingsByStart.get(slotStart) || [];
    const availability = slotAvailability(slotBookings, selectedBookingType);
    const isPast = bookingDate < today || (bookingDate === today && min <= currentMinutes);
    const paid = min >= APP_CONFIG.PAID_FROM_HOUR * 60;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `slot ${paid ? "paid-slot" : "free-slot"}`;
    button.innerHTML = `<span class="slot-time">${slotStart}–${slotEnd}</span><span class="slot-price">${paid ? "A pagamento" : "Gratuito"}</span>`;

    if (!availability.available) {
      button.classList.add("occupied"); button.disabled = true;
      const status = document.createElement("span"); status.className = "slot-status"; status.textContent = availability.label;
      button.appendChild(status);
      if (availability.customer) {
        const customer = document.createElement("span"); customer.className = "slot-customer"; customer.textContent = availability.customer;
        button.appendChild(customer);
      }
    } else if (isPast || !bookingsEnabled || isDateClosed(bookingDate)) {
      button.classList.add("past"); button.disabled = true;
      const status = document.createElement("span"); status.className = "slot-status"; status.textContent = "Non disponibile"; button.appendChild(status);
    } else {
      const status = document.createElement("span"); status.className = "slot-status available-label"; status.textContent = availability.label; button.appendChild(status);
      button.addEventListener("click", () => {
        document.querySelectorAll(".slot.selected").forEach(el => el.classList.remove("selected"));
        button.classList.add("selected"); selectedStart = slotStart; selectedEnd = slotEnd;
        selectedText.textContent = `Orario selezionato: ${slotStart}–${slotEnd} · ${selectedBookingType === "MEZZO" ? "mezzo campo" : "campo intero"} · ${bookingPriceLabel(slotStart, selectedBookingType)}`;
        showSelectedWeather(dataInput.value, slotStart);
        saveBookingDraft();
      });
    }
    slotsBox.appendChild(button);
  }
}

async function createBooking() {
  clearMessage();
  if (!bookingsEnabled) return showMessage("Le prenotazioni sono temporaneamente sospese.", "warning");
  if (isDateClosed(dataInput.value)) return showMessage(closureMessage || "La data selezionata non è disponibile per chiusura.", "warning");

  const nomeCliente = formatPersonName($("nome").value);
  const telefono = formatPhone($("telefono").value);
  const documentoNumero = normalizeDocument($("documento-numero").value);
  const documentoData = $("documento-data-rilascio").value;
  let documentoRilasciatoDa = $("documento-rilasciato-da").value.trim();
  const fieldId = campoSelect.value;
  const bookingDate = dataInput.value;
  const tipoPrenotazione = halfFieldEnabled ? selectedBookingType : "INTERO";
  const numeroBambini = tipoPrenotazione === "MEZZO" ? Number($("numero-bambini").value) : null;

  if (!bookingDate || !fieldId || !selectedStart) return showMessage("Seleziona data, campo e orario.", "warning");
  if (tipoPrenotazione === "MEZZO" && (!Number.isInteger(numeroBambini) || numeroBambini < 1 || numeroBambini > maxChildrenHalfField)) {
    return showMessage(`Indica un numero di bambini compreso tra 1 e ${maxChildrenHalfField}.`, "warning");
  }
  if (!nomeCliente || !telefono || !documentoNumero || !documentoData || !documentoRilasciatoDa) return showMessage("Compila tutti i dati obbligatori, compresi quelli della carta d’identità.", "warning");
  if (!/^3\d{2} \d{3} \d{4}$/.test(telefono)) return showMessage("Inserisci un numero di cellulare italiano valido, ad esempio 328 673 9425.", "error");
  if (!validateIdentityCardNumber(documentoNumero)) return showMessage("Il numero della Carta d’Identità Elettronica non è valido. Usa il formato CA12345AA.", "error");
  if (documentoData > localTodayIso()) return showMessage("La data di rilascio della carta d’identità non può essere futura.", "error");
  if (!municipalitiesReady) return showMessage("L’elenco dei Comuni non è stato caricato. Aggiorna la pagina e riprova.", "error");
  if (!validateMunicipality(documentoRilasciatoDa)) return showMessage("Seleziona un Comune reale dall’elenco proposto.", "error");
  documentoRilasciatoDa = italianMunicipalities.get(normalizeSearchText(documentoRilasciatoDa));
  if (!$("privacy").checked) return showMessage("Devi leggere e accettare l’informativa privacy per continuare.", "warning");

  const fieldName = fields.find(c => String(c.id) === String(fieldId))?.nome || "Campo";
  prenotaButton.disabled = true; prenotaButton.textContent = "Prenotazione in corso...";

  const { data, error } = await db.rpc("crea_prenotazione_v4_1", {
    p_campo_id: fieldId,
    p_nome_cliente: nomeCliente,
    p_telefono: telefono,
    p_documento_numero: documentoNumero,
    p_documento_data_rilascio: documentoData,
    p_documento_rilasciato_da: documentoRilasciatoDa,
    p_data: bookingDate,
    p_ora_inizio: selectedStart,
    p_ora_fine: selectedEnd,
    p_note: $("note").value.trim() || null,
    p_tipo_prenotazione: tipoPrenotazione,
    p_numero_bambini: numeroBambini
  });

  if (error) {
    prenotaButton.disabled = false;
    prenotaButton.textContent = "Conferma prenotazione";
    const msg = String(error.message || "");
    if (msg.includes("LIMITE_SETTIMANALE")) return showMessage(`Hai già effettuato due prenotazioni per questa settimana. Per modifiche o annullamenti telefona al ${APP_CONFIG.CONTACT_PHONE_DISPLAY}.`, "error");
    if (msg.includes("ORARIO_OCCUPATO") || msg.includes("MEZZI_CAMPI_COMPLETI") || error.code === "23505") { await loadSlots(); return showMessage("La disponibilità di questo orario è appena cambiata. Seleziona nuovamente una fascia.", "error"); }
    if (msg.includes("PRENOTAZIONI_SOSPESE")) return showMessage("Le prenotazioni sono temporaneamente sospese.", "error");
    return showMessage("Prenotazione non riuscita: " + msg, "error");
  }

  const confirmedStart = selectedStart, confirmedEnd = selectedEnd;
  const assignedSector = data?.settore || (tipoPrenotazione === "INTERO" ? "INTERO" : "");
  const usageLabel = assignedSector === "INTERO"
    ? "Campo intero"
    : `Mezzo campo ${assignedSector}${numeroBambini ? ` · ${numeroBambini} bambini` : ""}`;
  prenotaButton.disabled = true;
  prenotaButton.classList.add("booking-completed");
  prenotaButton.textContent = "✓ Prenotazione completata — guarda qui sotto";
  ["nome","telefono","documento-numero","documento-data-rilascio","documento-rilasciato-da","note","numero-bambini"].forEach(id => $(id).value = "");
  municipalitySelectionConfirmed = false;
  closeMunicipalitySuggestions();
  $("privacy").checked = false;
  dataInput.value = localTodayIso();
  updateDateDescription();
  await loadSlots({ preserveMessage: true });
  const confirmedCost = Number(data?.costo_applicato ?? bookingPriceForSlot(confirmedStart, tipoPrenotazione));
  const confirmedCostLabel = confirmedCost > 0 ? euroLabel(confirmedCost) : "Gratuito";
  clearBookingDraft();
  const confirmationHtml = `<strong>✅ Prenotazione confermata</strong><br>${fieldName}, ${usageLabel}, ${formatDateItalian(bookingDate)}, ${confirmedStart}–${confirmedEnd}.<br><br><strong>💶 Costo: ${confirmedCostLabel}</strong><br><small>${confirmedCost > 0 ? "Pagamento presso il centro sportivo." : "Questa fascia oraria è gratuita."}</small><br><br><strong>📷 Fai uno screenshot di questa schermata</strong> per ricordarti dell’appuntamento.<br><br>Per modificare o annullare telefona al <a href="tel:${APP_CONFIG.CONTACT_PHONE_LINK}"><strong>${APP_CONFIG.CONTACT_PHONE_DISPLAY}</strong></a>.`;
  showMessage(confirmationHtml, "success", true);
  const confirmationBox = $("messaggio");
  if (confirmationBox) confirmationBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

dataInput.min = localTodayIso(); dataInput.value = localTodayIso();
updateDateDescription();
$("documento-data-rilascio").max = localTodayIso();
$("documento-numero").addEventListener("input", event => { event.target.value = normalizeDocument(event.target.value).slice(0, 9); });
$("nome").addEventListener("blur", event => {
  event.target.value = formatPersonName(event.target.value);
});
$("telefono").addEventListener("blur", event => {
  event.target.value = formatPhone(event.target.value);
});
dataInput.addEventListener("change", loadSlots);
dataInput.addEventListener("change", updateDateDescription); campoSelect.addEventListener("change", loadSlots);
document.querySelectorAll('input[name="tipo-prenotazione"]').forEach(input => input.addEventListener("change", async () => {
  updateBookingModeUi();
  await loadSlots();
}));
$("aggiorna").addEventListener("click", loadSlots); prenotaButton.addEventListener("click", createBooking);
$("documento-rilasciato-da").addEventListener("input", () => {
  municipalitySelectionConfirmed = false;
  updateMunicipalitySuggestions();
});
$("documento-rilasciato-da").addEventListener("focus", updateMunicipalitySuggestions);
document.addEventListener("pointerdown", event => {
  if (!event.target.closest(".municipality-field")) closeMunicipalitySuggestions();
});
const draftFields = [
  "nome",
  "telefono",
  "documento-numero",
  "documento-data-rilascio",
  "documento-rilasciato-da",
  "note",
  "numero-bambini"
];

draftFields.forEach(id => {
  $(id)?.addEventListener("input", saveBookingDraft);
  $(id)?.addEventListener("change", saveBookingDraft);
});
dataInput.addEventListener("change", saveBookingDraft);
campoSelect.addEventListener("change", saveBookingDraft);
document.querySelectorAll('input[name="tipo-prenotazione"]').forEach(input =>
  input.addEventListener("change", saveBookingDraft)
);
const privacyDialog = $("privacy-dialog");
const openPrivacyLink = $("apri-privacy");

function closePrivacyDialog() {
  if (privacyDialog?.open) privacyDialog.close();
}

openPrivacyLink?.addEventListener("click", event => {
  event.preventDefault();
  saveBookingDraft();
  if (privacyDialog?.showModal) privacyDialog.showModal();
  else window.open("./privacy.html", "_blank", "noopener");
});
$("chiudi-privacy")?.addEventListener("click", closePrivacyDialog);
$("torna-prenotazione")?.addEventListener("click", closePrivacyDialog);
privacyDialog?.addEventListener("click", event => {
  if (event.target === privacyDialog) closePrivacyDialog();
});
window.addEventListener("pagehide", saveBookingDraft);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveBookingDraft();
});
window.addEventListener("pageshow", event => {
  restoreBookingDraftFieldsImmediately();
  if (event.persisted) restoreBookingDraft();
});

// Ripristina subito i campi personali, senza aspettare rete, Supabase o Comuni.
// Il completamento asincrono ripristinerà poi campo, modalità e fascia oraria.
restoreBookingDraftFieldsImmediately();

(async () => {
  await Promise.all([loadBookingStatus(), loadItalianMunicipalities()]);
  await loadFields();
  await restoreBookingDraft();
})();
