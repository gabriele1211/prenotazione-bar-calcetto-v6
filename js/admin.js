const $ = (id) => document.getElementById(id);
let loadedBookings = [];
let settingsLoaded = false;
let settingsLoading = false;
const bookingWeather = new Map();
let weatherRenderToken = 0;
let managerFullFieldPrice = 0;
let managerHalfFieldPrice = 0;



function weatherBookingKey(item) {
  return `${item.data}|${cleanTime(item.ora_inizio)}`;
}

async function loadWeatherForBookings(bookings, force = false) {
  if (!window.WeatherService || !bookings?.length) return;
  const token = ++weatherRenderToken;
  const unique = new Map();
  bookings
    .filter(item => item.stato === "confermata")
    .forEach(item => unique.set(weatherBookingKey(item), item));

  await Promise.all([...unique.values()].map(async item => {
    try {
      const weather = await WeatherService.getForBooking(item.data, item.ora_inizio, force);
      if (token !== weatherRenderToken) return;
      bookingWeather.set(weatherBookingKey(item), weather);
    } catch (error) {
      console.warn("Meteo non disponibile:", error);
      bookingWeather.set(weatherBookingKey(item), null);
    }
  }));

  if (token === weatherRenderToken) renderBookings();
}

async function showPlanningWeather(force = false) {
  const box = $("meteo-planning");
  const date = $("data-planning-pdf")?.value;
  if (!box || !date || !window.WeatherService) return;
  box.classList.remove("hidden");
  box.innerHTML = '<div class="weather-card weather-loading">🌦️ Caricamento previsione del giorno…</div>';

  const times = loadedBookings
    .filter(item => item.data === date && item.stato === "confermata")
    .map(item => cleanTime(item.ora_inizio));

  const time = times.sort()[0] || "18:00";
  try {
    const weather = await WeatherService.getForBooking(date, time, force);
    box.innerHTML = WeatherService.detailedHtml(weather, "Previsioni di oggi");
  } catch (error) {
    box.innerHTML = '<div class="weather-card weather-unknown"><strong>🌦️ Meteo momentaneamente non disponibile</strong></div>';
  }
}

function showBox(id, text, type = "warning") {
  const box = $(id);
  box.textContent = text;
  box.className = `message show ${type}`;
}
function localDate(dateString) { return new Date(`${dateString}T12:00:00`).toLocaleDateString("it-IT"); }
function cleanTime(time) { return String(time || "").slice(0, 5); }
function safeText(value) { return String(value ?? ""); }
function normalize(value) { return safeText(value).toLocaleLowerCase("it-IT").trim(); }


function escapeHtml(value) {
  return safeText(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

function fullItalianDate(dateString) {
  if (!dateString) return "—";
  return new Date(`${dateString}T12:00:00`).toLocaleDateString("it-IT", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
}


function isPaidTimeSlot(startTime) {
  const hour = Number(cleanTime(startTime).slice(0, 2));
  return hour >= 19 && hour < 22;
}

function bookingCost(item) {
  if (!item) return 0;

  if (item.costo_applicato !== null && item.costo_applicato !== undefined) {
    return Number(item.costo_applicato || 0);
  }

  // Compatibilità con prenotazioni create prima della migrazione SQL.
  if (!isPaidTimeSlot(item.ora_inizio)) return 0;
  const isHalf = ["A", "B"].includes(item.settore);
  return isHalf ? managerHalfFieldPrice : managerFullFieldPrice;
}

function euroAmount(value) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR"
  }).format(Number(value || 0));
}

function bookingCostLabel(item) {
  const amount = bookingCost(item);
  return amount > 0 ? euroAmount(amount) : "Gratuito";
}

function usageLabel(item) {
  return item.settore === "INTERO" || !item.settore
    ? "Campo intero"
    : `Mezzo campo ${item.settore}${item.numero_bambini ? ` · ${item.numero_bambini} bambini` : ""}`;
}

function bookingCode(item) {
  const datePart = safeText(item.data).replaceAll("-", "");
  return `PR-${datePart}-${safeText(item.id).slice(0, 6).toUpperCase()}`;
}

function openPrintDocument(title, bodyHtml, landscape = false) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Il browser ha bloccato la finestra di stampa. Consenti i popup per questo sito e riprova.");
    return;
  }
  const logoUrl = new URL("./assets/gf-logo.png", window.location.href).href;
  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
@page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 14mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; color: #172033; margin: 0; font-size: 12px; }
.print-header { display:flex; align-items:center; justify-content:space-between; gap:20px; border-bottom:3px solid #173f75; padding-bottom:10px; margin-bottom:18px; }
.print-header img { width:72px; height:auto; }
h1 { font-size:22px; margin:0 0 4px; color:#173f75; }
h2 { font-size:16px; margin:18px 0 8px; color:#173f75; border-bottom:1px solid #ccd5e1; padding-bottom:5px; }
p { margin:4px 0; }
.meta { color:#526071; }
.info-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 22px; }
.info-item { padding:7px 0; border-bottom:1px solid #e2e7ed; }
.info-item strong { display:block; font-size:10px; text-transform:uppercase; color:#667587; margin-bottom:2px; }
.notice { margin-top:18px; border:1px solid #d5dde7; background:#f7f9fc; padding:10px; border-radius:7px; }
.signatures { display:grid; grid-template-columns:1fr 1fr; gap:45px; margin-top:55px; }
.signature { border-top:1px solid #333; text-align:center; padding-top:7px; }
table { width:100%; border-collapse:collapse; margin-top:12px; }
th, td { border:1px solid #cbd4df; padding:7px; text-align:left; vertical-align:top; }
th { background:#eaf1f8; color:#173f75; font-size:11px; }
tr:nth-child(even) td { background:#f8fafc; }
.status { font-weight:bold; }
.print-footer { margin-top:18px; padding-top:8px; border-top:1px solid #ccd5e1; color:#6a7583; font-size:10px; display:flex; justify-content:space-between; }

.print-toolbar {
  display:flex;
  justify-content:space-between;
  gap:10px;
  margin:0 0 15px;
  padding:0 0 12px;
  border-bottom:1px solid #ccd5e1;
}
.print-toolbar button {
  border:1px solid #aeb9c8;
  background:#fff;
  border-radius:8px;
  padding:9px 14px;
  font-weight:700;
  cursor:pointer;
}

@media print { .no-print { display:none !important; } }
</style></head><body>
<div class="print-toolbar no-print">
<button type="button" onclick="window.opener?.focus(); window.close();">← Torna all’Area gestore</button>
<button type="button" onclick="window.print()">🖨️ Stampa</button>
</div>
<div class="print-header"><div><h1>Campo Ex Velodromo</h1><p class="meta">Prenotazione campo</p></div><img src="${logoUrl}" alt="GF"></div>
${bodyHtml}
<div class="print-footer"><span>Documento generato il ${new Date().toLocaleString("it-IT")}</span><span>Versione 5.2.1</span></div>
<script>
window.addEventListener('load', () => {
  setTimeout(() => {
    window.focus();
    window.print();
  }, 500);
});
<\/script>
</body></html>`);
  printWindow.document.close();
}

async function printSingleBooking(item) {
  let weatherPrint = "Previsione non disponibile";
  try {
    const weather = await WeatherService.getForBooking(item.data, item.ora_inizio);
    if (weather) weatherPrint = `${weather.description.icon} ${weather.description.label}, ${weather.temperature}°C · pioggia ${weather.precipitationProbability}% · vento ${weather.windSpeed} km/h`;
  } catch (_) {}

  const body = `
    <h1 style="font-size:20px">Richiesta di prenotazione</h1>
    <p class="meta"><strong>Codice:</strong> ${escapeHtml(bookingCode(item))}</p>
    <h2>Dati della prenotazione</h2>
    <div class="info-grid">
      <div class="info-item"><strong>Campo</strong>${escapeHtml(item.campi?.nome || "Campo")}</div>
      <div class="info-item"><strong>Utilizzo</strong>${escapeHtml(usageLabel(item))}</div>
      <div class="info-item"><strong>Data</strong>${escapeHtml(fullItalianDate(item.data))}</div>
      <div class="info-item"><strong>Orario</strong>${escapeHtml(cleanTime(item.ora_inizio))}–${escapeHtml(cleanTime(item.ora_fine))}</div>
      <div class="info-item"><strong>Stato</strong>${escapeHtml(item.stato || "—")}</div>
      <div class="info-item"><strong>Costo</strong>${escapeHtml(bookingCostLabel(item))}</div>
      <div class="info-item"><strong>Numero bambini</strong>${item.numero_bambini ? escapeHtml(item.numero_bambini) : "—"}</div>
    </div>
    <h2>Previsione meteo indicativa</h2>
    <div class="notice">${escapeHtml(weatherPrint)}<br><small>La previsione può cambiare e non costituisce garanzia delle condizioni effettive.</small></div>
    <h2>Adulto responsabile</h2>
    <div class="info-grid">
      <div class="info-item"><strong>Nome e cognome</strong>${escapeHtml(item.nome_cliente || "—")}</div>
      <div class="info-item"><strong>Telefono</strong>${escapeHtml(item.telefono || "—")}</div>
    </div>
    <h2>Documento d'identità</h2>
    <div class="info-grid">
      <div class="info-item"><strong>Numero</strong>${escapeHtml(item.documento_numero || "—")}</div>
      <div class="info-item"><strong>Data di rilascio</strong>${item.documento_data_rilascio ? escapeHtml(localDate(item.documento_data_rilascio)) : "—"}</div>
      <div class="info-item"><strong>Rilasciato da</strong>${escapeHtml(item.documento_rilasciato_da || "—")}</div>
    </div>
    <h2>Richieste o note</h2>
    <div class="notice">${escapeHtml(item.note || "Nessuna richiesta particolare.")}</div>
    <div class="notice"><strong>Verifica documento:</strong> il documento indicato deve essere presentato al gestore al momento del ritiro delle chiavi.</div>
    <div class="signatures"><div class="signature">Firma del gestore</div><div class="signature">Firma del cliente</div></div>`;
  openPrintDocument(`Prenotazione ${bookingCode(item)}`, body, false);
}

async function printDailyPlanning() {
  const chosenDate = $("data-planning-pdf").value;
  if (!chosenDate) return alert("Seleziona la data del planning da stampare.");
  const rows = loadedBookings
    .filter(item => item.data === chosenDate && item.stato === "confermata")
    .sort((a, b) => `${cleanTime(a.ora_inizio)}-${a.settore || ""}`.localeCompare(`${cleanTime(b.ora_inizio)}-${b.settore || ""}`));

  if (!rows.length) return alert("Non ci sono prenotazioni confermate per la data selezionata.");

  const weatherRows = await Promise.all(rows.map(async item => {
    try { return await WeatherService.getForBooking(item.data, item.ora_inizio); }
    catch (_) { return null; }
  }));

  const tableRows = rows.map((item, index) => `<tr>
    <td>${escapeHtml(cleanTime(item.ora_inizio))}–${escapeHtml(cleanTime(item.ora_fine))}</td>
    <td>${escapeHtml(item.campi?.nome || "Campo")}</td>
    <td><strong>${escapeHtml(usageLabel(item))}</strong></td>
    <td><strong>${escapeHtml(bookingCostLabel(item))}</strong></td>
    <td>${escapeHtml(item.nome_cliente || "—")}</td>
    <td>${escapeHtml(item.telefono || "—")}</td>
    <td>${escapeHtml(item.documento_numero || "—")}</td>
    <td>${escapeHtml(item.note || "—")}</td>
    <td>${weatherRows[index] ? `${weatherRows[index].description.icon} ${weatherRows[index].temperature}°C · pioggia ${weatherRows[index].precipitationProbability}%` : "—"}</td>
  </tr>`).join("");

  const planningTotal = rows.reduce((sum, item) => sum + bookingCost(item), 0);
  const body = `
    <h1 style="font-size:20px">Planning giornaliero</h1>
    <p class="meta"><strong>${escapeHtml(fullItalianDate(chosenDate))}</strong> · ${rows.length} prenotazioni confermate · <strong>Totale previsto: ${escapeHtml(euroAmount(planningTotal))}</strong></p>
    <table>
      <thead><tr><th>Orario</th><th>Campo</th><th>Utilizzo</th><th>Costo</th><th>Responsabile</th><th>Telefono</th><th>Documento</th><th>Note</th><th>Meteo</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="notice"><strong>Controllo al ritiro:</strong> verificare il documento dell'adulto responsabile prima della consegna delle chiavi.</div>`;
  openPrintDocument(`Planning ${chosenDate}`, body, true);
}

function bookingDateTime(dateValue, timeValue) {
  const time = cleanTime(timeValue);
  if (!dateValue || !time) return null;
  const value = new Date(`${dateValue}T${time}:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function temporalState(item, now = new Date()) {
  const start = bookingDateTime(item.data, item.ora_inizio);
  const end = bookingDateTime(item.data, item.ora_fine);
  if (!start || !end) return { current: false, concluded: false };

  const concludedAfter = new Date(end.getTime() + 60 * 60 * 1000);
  return {
    current: item.stato === "confermata" && now >= start && now < end,
    concluded: now >= concludedAfter
  };
}

async function loadFieldFilter() {
  const { data, error } = await db.from("campi").select("id,nome").order("nome");
  if (error) return $("admin-message").textContent = "Errore campi: " + error.message;
  $("filtro-campo").innerHTML = '<option value="">Tutti</option>' + (data || []).map(c => `<option value="${c.id}">${safeText(c.nome)}</option>`).join("");
}

function setSettingsControlsEnabled(enabled) {
  [
    "prenotazioni-attive",
    "chiusura-dal",
    "chiusura-al",
    "messaggio-chiusura",
    "mezzo-campo-attivo",
    "max-bambini-mezzo-campo",
    "prezzo-campo-intero",
    "prezzo-mezzo-campo",
    "salva-impostazioni"
  ].forEach(id => {
    const element = $(id);
    if (element) element.disabled = !enabled;
  });
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function loadSettings() {
  if (settingsLoading) return;
  settingsLoading = true;
  settingsLoaded = false;
  setSettingsControlsEnabled(false);
  showBox("settings-message", "Caricamento impostazioni da Supabase…", "info");

  try {
    let lastError = null;
    let data = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await db
        .from("impostazioni_prenotazioni")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

      if (!result.error && result.data) {
        data = result.data;
        break;
      }

      lastError = result.error || new Error("Riga delle impostazioni non trovata.");
      if (attempt < 3) await wait(700 * attempt);
    }

    if (!data) throw lastError || new Error("Impostazioni non disponibili.");

    // I controlli vengono aggiornati solo dopo aver ricevuto una riga valida.
    $("prenotazioni-attive").checked = data.prenotazioni_attive === true;
    $("chiusura-dal").value = data.chiusura_dal ?? "";
    $("chiusura-al").value = data.chiusura_al ?? "";
    $("messaggio-chiusura").value = data.messaggio_chiusura ?? "";
    $("mezzo-campo-attivo").checked = data.mezzo_campo_attivo === true;
    $("max-bambini-mezzo-campo").value =
      data.max_bambini_mezzo_campo ?? 6;
    managerFullFieldPrice = Number(data.prezzo_campo_intero ?? 0);
    managerHalfFieldPrice = Number(data.prezzo_mezzo_campo ?? 0);
    $("prezzo-campo-intero").value = managerFullFieldPrice;
    $("prezzo-mezzo-campo").value = managerHalfFieldPrice;

    settingsLoaded = true;
    setSettingsControlsEnabled(true);
    renderBookings();
    showBox("settings-message", "Impostazioni caricate correttamente.", "success");
  } catch (error) {
    console.error("Caricamento impostazioni fallito:", error);
    setSettingsControlsEnabled(false);
    showBox(
      "settings-message",
      "Impossibile leggere le impostazioni da Supabase. I valori non sono stati modificati. Controlla la connessione e premi «Ricarica impostazioni».",
      "error"
    );
  } finally {
    settingsLoading = false;
  }
}

async function saveSettings() {
  if (!settingsLoaded) {
    return showBox(
      "settings-message",
      "Attendi il caricamento delle impostazioni prima di salvarle.",
      "error"
    );
  }

  const dal = $("chiusura-dal").value || null;
  const al = $("chiusura-al").value || null;
  if (dal && al && dal > al) return showBox("settings-message", "La data finale deve essere successiva a quella iniziale.", "error");
  const { error } = await db.from("impostazioni_prenotazioni").update({
    prenotazioni_attive: $("prenotazioni-attive").checked,
    chiusura_dal: dal,
    chiusura_al: al,
    messaggio_chiusura: $("messaggio-chiusura").value.trim() || null,
    mezzo_campo_attivo: $("mezzo-campo-attivo").checked,
    max_bambini_mezzo_campo: Math.max(1, Number($("max-bambini-mezzo-campo").value || 6)),
    prezzo_campo_intero: Math.max(0, Number($("prezzo-campo-intero").value || 0)),
    prezzo_mezzo_campo: Math.max(0, Number($("prezzo-mezzo-campo").value || 0)),
    aggiornato_il: new Date().toISOString()
  }).eq("id", 1);
  if (error) return showBox("settings-message", "Salvataggio non riuscito: " + error.message, "error");
  managerFullFieldPrice = Math.max(0, Number($("prezzo-campo-intero").value || 0));
  managerHalfFieldPrice = Math.max(0, Number($("prezzo-mezzo-campo").value || 0));
  renderBookings();
  showBox("settings-message", "Impostazioni salvate.", "success");
}

function filteredAndSortedBookings() {
  const term = normalize($("filtro-testo").value);
  const status = $("filtro-stato").value;
  const order = $("filtro-ordine").value;
  const filtered = loadedBookings.filter(item => {
    if (status && item.stato !== status) return false;
    if (!term) return true;
    const haystack = [item.nome_cliente, item.telefono, item.documento_numero, item.documento_rilasciato_da, item.note, item.campi?.nome, item.settore, item.numero_bambini, item.data, cleanTime(item.ora_inizio)].map(normalize).join(" ");
    return haystack.includes(term);
  });
  filtered.sort((a, b) => {
    const aKey = `${a.data}T${cleanTime(a.ora_inizio)}`;
    const bKey = `${b.data}T${cleanTime(b.ora_inizio)}`;
    return order === "vicine" ? aKey.localeCompare(bKey) : bKey.localeCompare(aKey);
  });
  return filtered;
}

function renderBookings() {
  const body = $("prenotazioni-body");
  const bookings = filteredAndSortedBookings();
  $("metrica-totale").textContent = bookings.length;
  $("metrica-confermate").textContent = bookings.filter(x => x.stato === "confermata").length;
  $("metrica-annullate").textContent = bookings.filter(x => x.stato === "annullata").length;
  $("admin-message").textContent = bookings.length ? `${bookings.length} prenotazioni visualizzate.` : "Nessuna prenotazione trovata.";
  body.innerHTML = "";

  const now = new Date();

  bookings.forEach(item => {
    const tr = document.createElement("tr");
    const timeState = temporalState(item, now);
    if (item.note) tr.classList.add("has-request");
    if (timeState.current) tr.classList.add("booking-current");
    else if (timeState.concluded) tr.classList.add("booking-concluded");
    const utilizzo = usageLabel(item).replace("Mezzo campo", "Mezzo");
    const cells = [
      localDate(item.data),
      `${cleanTime(item.ora_inizio)}–${cleanTime(item.ora_fine)}`,
      item.campi?.nome || "Campo",
      utilizzo,
      bookingCostLabel(item),
      item.nome_cliente || "",
      item.telefono || ""
    ];
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      if (i === 4) {
        td.className = bookingCost(item) > 0 ? "booking-cost paid" : "booking-cost free";
        const strong = document.createElement("strong");
        strong.textContent = text;
        td.appendChild(strong);
      } else if (i === 5) {
        const strong = document.createElement("strong");
        strong.textContent = text;
        td.appendChild(strong);
      } else {
        td.textContent = text;
      }
      tr.appendChild(td);
    });
    const docTd = document.createElement("td");
    docTd.innerHTML = `<strong></strong><br><small></small>`;
    docTd.querySelector("strong").textContent = item.documento_numero || "—";
    docTd.querySelector("small").textContent = item.documento_data_rilascio ? `${localDate(item.documento_data_rilascio)} · ${item.documento_rilasciato_da || ""}` : "";
    tr.appendChild(docTd);
    const noteTd = document.createElement("td");
    if (item.note) {
      const badge = document.createElement("span"); badge.className = "request-badge"; badge.textContent = "📌 Richiesta";
      const p = document.createElement("p"); p.className = "request-text"; p.textContent = item.note;
      noteTd.append(badge, p);
    } else noteTd.textContent = "—";
    tr.appendChild(noteTd);
    const weatherTd = document.createElement("td");
    weatherTd.className = "weather-table-cell";
    if (item.stato !== "confermata") {
      weatherTd.textContent = "—";
    } else if (bookingWeather.has(weatherBookingKey(item))) {
      weatherTd.innerHTML = WeatherService.compactHtml(bookingWeather.get(weatherBookingKey(item)));
    } else {
      weatherTd.innerHTML = '<span class="weather-loading-inline">Caricamento…</span>';
    }
    tr.appendChild(weatherTd);
    const statusTd = document.createElement("td");
    const statusBadge = document.createElement("span");

    if (timeState.current) {
      statusBadge.className = "status in-corso";
      statusBadge.textContent = "▶ IN CORSO";
    } else if (timeState.concluded && item.stato === "confermata") {
      statusBadge.className = "status conclusa";
      statusBadge.textContent = "Conclusa";
    } else {
      statusBadge.className = `status ${item.stato}`;
      statusBadge.textContent = item.stato;
    }

    statusTd.appendChild(statusBadge);
    tr.appendChild(statusTd);
    const actionTd = document.createElement("td");
    const actionBox = document.createElement("div");
    actionBox.className = "row-actions";

    const statusButton = document.createElement("button");
    statusButton.className = "mini-button";
    statusButton.type = "button";
    statusButton.dataset.action = "status";
    statusButton.dataset.id = item.id;
    statusButton.dataset.status = item.stato === "annullata" ? "confermata" : "annullata";
    statusButton.textContent = item.stato === "annullata" ? "Ripristina" : "Annulla";

    const pdfButton = document.createElement("button");
    pdfButton.className = "mini-button print-booking";
    pdfButton.type = "button";
    pdfButton.dataset.action = "print";
    pdfButton.dataset.id = item.id;
    pdfButton.textContent = "📄 PDF";

    const deleteButton = document.createElement("button");
    deleteButton.className = "mini-button delete-booking";
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete";
    deleteButton.dataset.id = item.id;
    deleteButton.dataset.customer = item.nome_cliente || "cliente";
    deleteButton.dataset.booking = `${localDate(item.data)} ${cleanTime(item.ora_inizio)}`;
    deleteButton.textContent = "Elimina";

    if (!timeState.concluded) {
      actionBox.appendChild(statusButton);
    }
    actionBox.appendChild(pdfButton);
    actionBox.appendChild(deleteButton);
    actionTd.appendChild(actionBox);
    tr.appendChild(actionTd);
    body.appendChild(tr);
  });

  body.querySelectorAll('button[data-action="print"]').forEach(button => button.addEventListener("click", () => {
    const item = loadedBookings.find(booking => booking.id === button.dataset.id);
    if (!item) return alert("Prenotazione non trovata.");
    printSingleBooking(item);
  }));

  body.querySelectorAll('button[data-action="status"]').forEach(button => button.addEventListener("click", async () => {
    const { error } = await db.from("prenotazioni").update({ stato: button.dataset.status }).eq("id", button.dataset.id);
    if (error) return alert("Aggiornamento non riuscito: " + error.message);
    await loadBookings();
  }));

  body.querySelectorAll('button[data-action="delete"]').forEach(button => button.addEventListener("click", async () => {
    const firstConfirm = confirm(`Eliminare definitivamente la prenotazione di ${button.dataset.customer} del ${button.dataset.booking}?`);
    if (!firstConfirm) return;
    const secondConfirm = confirm("Conferma finale: tutti i dati personali della prenotazione saranno cancellati e non potranno essere recuperati.");
    if (!secondConfirm) return;

    button.disabled = true;
    button.textContent = "Eliminazione…";
    const { data, error } = await db.rpc("elimina_prenotazione_gestore", { p_prenotazione_id: button.dataset.id });
    if (error) {
      button.disabled = false;
      button.textContent = "Elimina";
      return alert("Eliminazione non riuscita: " + error.message);
    }
    if (!data) alert("La prenotazione era già stata eliminata o non è stata trovata.");
    await loadBookings();
  }));
}

async function loadBookings() {
  const body = $("prenotazioni-body");
  body.innerHTML = '<tr><td colspan="12">Caricamento...</td></tr>';
  let query = db.from("prenotazioni").select(`id,campo_id,nome_cliente,telefono,documento_numero,documento_data_rilascio,documento_rilasciato_da,data,ora_inizio,ora_fine,stato,note,settore,numero_bambini,costo_applicato,campi(nome)`);
  if ($("filtro-da").value) query = query.gte("data", $("filtro-da").value);
  if ($("filtro-a").value) query = query.lte("data", $("filtro-a").value);
  if ($("filtro-campo").value) query = query.eq("campo_id", $("filtro-campo").value);
  const { data, error } = await query;
  if (error) { $("admin-message").textContent = "Errore: " + error.message; body.innerHTML = ""; return; }
  loadedBookings = data || [];
  renderBookings();
  loadWeatherForBookings(loadedBookings);
  showPlanningWeather();
}

function resetFilters() {
  $("filtro-testo").value = "";
  $("filtro-stato").value = "";
  $("filtro-campo").value = "";
  $("filtro-ordine").value = "recenti";
  $("filtro-da").value = "";
  $("filtro-a").value = "";
  loadBookings();
}

async function checkSession() {
  const { data } = await db.auth.getSession();
  const logged = Boolean(data.session);
  $("login-box").classList.toggle("hidden", logged);
  $("dashboard").classList.toggle("hidden", !logged);
  if (logged) await Promise.all([loadFieldFilter(), loadSettings(), loadBookings()]);
}

$("login").addEventListener("click", async () => {
  const { error } = await db.auth.signInWithPassword({ email: $("login-email").value.trim(), password: $("login-password").value });
  if (error) return showBox("login-message", "Accesso non riuscito: " + error.message, "error");
  await checkSession();
});
$("logout").addEventListener("click", async () => { await db.auth.signOut(); await checkSession(); });
$("carica").addEventListener("click", loadBookings);
$("azzera-filtri").addEventListener("click", resetFilters);
$("salva-impostazioni").addEventListener("click", saveSettings);
$("ricarica-impostazioni")?.addEventListener("click", loadSettings);
window.addEventListener("online", () => {
  if (!$("dashboard").classList.contains("hidden") && !settingsLoaded) {
    loadSettings();
  }
});
$("stampa-planning").addEventListener("click", printDailyPlanning);
$("aggiorna-meteo")?.addEventListener("click", async () => {
  bookingWeather.clear();
  await loadWeatherForBookings(loadedBookings, true);
  await showPlanningWeather(true);
});
$("data-planning-pdf")?.addEventListener("change", () => showPlanningWeather());
["filtro-testo", "filtro-stato", "filtro-ordine"].forEach(id => $(id).addEventListener("input", renderBookings));
["filtro-da", "filtro-a", "filtro-campo"].forEach(id => $(id).addEventListener("change", loadBookings));

$("filtro-da").value = "";
$("filtro-a").value = "";
$("data-planning-pdf").value = new Date().toISOString().slice(0, 10);
checkSession();


// Aggiorna automaticamente gli stati "In corso" e "Conclusa".
setInterval(() => {
  if (!$("dashboard").classList.contains("hidden") && loadedBookings.length) {
    renderBookings();
  }
}, 60 * 1000);


function escapePrintHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function archiveUsageLabel(item) {
  if (!item.settore || item.settore === "INTERO") return "Campo intero";
  const children = item.numero_bambini ? ` · ${item.numero_bambini} bambini` : "";
  return `Mezzo campo ${item.settore}${children}`;
}

function archiveStatusLabel(status) {
  const value = String(status || "").toLowerCase();
  if (value === "confermata") return "Confermata";
  if (value === "annullata") return "Annullata";
  return status || "";
}

async function stampaArchivioCompleto() {
  const button = $("stampa-archivio-completo");
  const originalText = button?.textContent || "Stampa archivio completo";

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Preparazione archivio…";
    }

    const { data, error } = await db
      .from("prenotazioni")
      .select(`
        id,
        created_at,
        data,
        ora_inizio,
        ora_fine,
        stato,
        settore,
        numero_bambini,
        costo_applicato,
        nome_cliente,
        telefono,
        documento_numero,
        documento_data_rilascio,
        documento_rilasciato_da,
        note,
        campi(nome)
      `)
      .order("data", { ascending: true })
      .order("ora_inizio", { ascending: true });

    if (error) throw error;

    const records = data || [];
    if (!records.length) {
      showAdminMessage?.("Non ci sono prenotazioni da stampare.", "warning");
      return;
    }

    const generatedAt = new Intl.DateTimeFormat("it-IT", {
      dateStyle: "full",
      timeStyle: "short"
    }).format(new Date());

    const rows = records.map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapePrintHtml(item.data ? localDate(item.data) : "")}</td>
        <td>${escapePrintHtml(`${cleanTime(item.ora_inizio)}–${cleanTime(item.ora_fine)}`)}</td>
        <td>${escapePrintHtml(item.campi?.nome || "Campo")}</td>
        <td>${escapePrintHtml(archiveUsageLabel(item))}</td>
        <td><strong>${escapePrintHtml(bookingCostLabel(item))}</strong></td>
        <td>${escapePrintHtml(item.nome_cliente || "")}</td>
        <td>${escapePrintHtml(item.telefono || "")}</td>
        <td>${escapePrintHtml(item.documento_numero || "")}</td>
        <td>${escapePrintHtml(item.documento_data_rilascio ? localDate(item.documento_data_rilascio) : "")}</td>
        <td>${escapePrintHtml(item.documento_rilasciato_da || "")}</td>
        <td>${escapePrintHtml(archiveStatusLabel(item.stato))}</td>
        <td>${escapePrintHtml(item.note || "")}</td>
      </tr>
    `).join("");

    const confirmed = records.filter(x => String(x.stato).toLowerCase() === "confermata").length;
    const cancelled = records.filter(x => String(x.stato).toLowerCase() === "annullata").length;
    const whole = records.filter(x => !x.settore || x.settore === "INTERO").length;
    const half = records.filter(x => ["A", "B"].includes(x.settore)).length;
    const archiveTotal = records
      .filter(x => String(x.stato).toLowerCase() === "confermata")
      .reduce((sum, item) => sum + bookingCost(item), 0);

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      throw new Error("Il browser ha bloccato la finestra di stampa. Consenti i popup per questo sito.");
    }

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Archivio completo prenotazioni</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: #111827;
      font-size: 10px;
    }
    h1 { margin: 0 0 4px; font-size: 20px; }
    .subtitle { margin-bottom: 12px; color: #4b5563; }
    .summary {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin: 0 0 14px;
    }
    .summary span {
      border: 1px solid #cbd5e1;
      border-radius: 5px;
      padding: 5px 8px;
      background: #f8fafc;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: auto;
    }
    th, td {
      border: 1px solid #9ca3af;
      padding: 4px;
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th {
      background: #e5e7eb;
      font-size: 9px;
    }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .footer {
      margin-top: 10px;
      color: #6b7280;
      font-size: 9px;
    }

    .print-toolbar {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin: 0 0 12px;
      padding: 0 0 10px;
      border-bottom: 1px solid #cbd5e1;
    }
    .print-toolbar button {
      border: 1px solid #9ca3af;
      border-radius: 6px;
      background: #fff;
      padding: 8px 12px;
      font-weight: 700;
      cursor: pointer;
    }

    @media print {
      .no-print { display: none !important; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="print-toolbar no-print">
    <button type="button" onclick="window.opener?.focus(); window.close();">← Torna all’Area gestore</button>
    <button type="button" onclick="window.print()">🖨️ Stampa</button>
  </div>
  <h1>Archivio completo delle prenotazioni</h1>
  <div class="subtitle">Campo Ex Velodromo · generato ${escapePrintHtml(generatedAt)}</div>

  <div class="summary">
    <span><strong>Totale:</strong> ${records.length}</span>
    <span><strong>Confermate:</strong> ${confirmed}</span>
    <span><strong>Annullate:</strong> ${cancelled}</span>
    <span><strong>Campo intero:</strong> ${whole}</span>
    <span><strong>Mezzi campi:</strong> ${half}</span>
    <span><strong>Totale previsto confermato:</strong> ${escapePrintHtml(euroAmount(archiveTotal))}</span>
  </div>

  <table>
    <thead>
      <tr>
        <th>N.</th>
        <th>Data</th>
        <th>Orario</th>
        <th>Campo</th>
        <th>Utilizzo</th>
        <th>Costo</th>
        <th>Cliente</th>
        <th>Telefono</th>
        <th>Documento</th>
        <th>Rilascio</th>
        <th>Rilasciato da</th>
        <th>Stato</th>
        <th>Note</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="footer">
    Documento ad uso gestionale. Contiene dati personali: conservarlo e trattarlo nel rispetto della normativa applicabile.
  </div>

  <script>
    window.addEventListener("load", () => {
      setTimeout(() => {
        window.focus();
        window.print();
      }, 500);
    });
  <\/script>
</body>
</html>`);
    printWindow.document.close();
  } catch (error) {
    console.error("Errore stampa archivio completo:", error);
    alert(error?.message || "Non è stato possibile preparare l’archivio completo.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}


const archivePrintButton = $("stampa-archivio-completo");
if (archivePrintButton) {
  archivePrintButton.addEventListener("click", stampaArchivioCompleto);
}
