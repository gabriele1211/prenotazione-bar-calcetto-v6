
window.WeatherService = (() => {
  const config = {
    locationName: APP_CONFIG.WEATHER_LOCATION_NAME || "Bologna",
    latitude: Number(APP_CONFIG.WEATHER_LATITUDE ?? 44.4949),
    longitude: Number(APP_CONFIG.WEATHER_LONGITUDE ?? 11.3426),
    timezone: APP_CONFIG.WEATHER_TIMEZONE || "Europe/Rome",
    forecastDays: 16,
    cacheMinutes: 20
  };

  let memoryCache = null;
  let pendingRequest = null;

  function cacheKey() {
    return `orione-weather-${config.latitude}-${config.longitude}`;
  }

  function weatherDescription(code) {
    const map = {
      0: ["☀️", "Sereno"],
      1: ["🌤️", "Prevalentemente sereno"],
      2: ["⛅", "Parzialmente nuvoloso"],
      3: ["☁️", "Coperto"],
      45: ["🌫️", "Nebbia"],
      48: ["🌫️", "Nebbia con brina"],
      51: ["🌦️", "Pioviggine debole"],
      53: ["🌦️", "Pioviggine"],
      55: ["🌧️", "Pioviggine intensa"],
      56: ["🌧️", "Pioviggine gelata"],
      57: ["🌧️", "Pioviggine gelata intensa"],
      61: ["🌦️", "Pioggia debole"],
      63: ["🌧️", "Pioggia"],
      65: ["🌧️", "Pioggia intensa"],
      66: ["🌧️", "Pioggia gelata"],
      67: ["🌧️", "Pioggia gelata intensa"],
      71: ["🌨️", "Neve debole"],
      73: ["🌨️", "Neve"],
      75: ["❄️", "Neve intensa"],
      77: ["🌨️", "Granelli di neve"],
      80: ["🌦️", "Rovesci deboli"],
      81: ["🌧️", "Rovesci"],
      82: ["⛈️", "Rovesci violenti"],
      85: ["🌨️", "Rovesci di neve"],
      86: ["❄️", "Rovesci di neve intensi"],
      95: ["⛈️", "Temporale"],
      96: ["⛈️", "Temporale con grandine"],
      99: ["⛈️", "Temporale forte con grandine"]
    };
    const [icon, label] = map[Number(code)] || ["🌡️", "Condizioni variabili"];
    return { icon, label };
  }

  function riskLevel(item) {
    if (!item) return "unknown";
    if (item.weatherCode >= 95 || item.precipitationProbability >= 70 || item.precipitation >= 2) return "bad";
    if (item.precipitationProbability >= 35 || item.windGust >= 45 || item.weatherCode >= 51) return "uncertain";
    return "good";
  }

  function readStoredCache() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(cacheKey()) || "null");
      if (!parsed || !parsed.savedAt || !parsed.data) return null;
      const age = Date.now() - parsed.savedAt;
      return age <= config.cacheMinutes * 60 * 1000 ? parsed.data : null;
    } catch (_) {
      return null;
    }
  }

  function saveCache(data) {
    memoryCache = data;
    try {
      sessionStorage.setItem(cacheKey(), JSON.stringify({ savedAt: Date.now(), data }));
    } catch (_) {}
  }

  async function fetchForecast(force = false) {
    if (!force && memoryCache) return memoryCache;
    if (!force) {
      const stored = readStoredCache();
      if (stored) {
        memoryCache = stored;
        return stored;
      }
    }
    if (pendingRequest && !force) return pendingRequest;

    const params = new URLSearchParams({
      latitude: String(config.latitude),
      longitude: String(config.longitude),
      hourly: [
        "temperature_2m",
        "precipitation_probability",
        "precipitation",
        "weather_code",
        "wind_speed_10m",
        "wind_gusts_10m"
      ].join(","),
      timezone: config.timezone,
      forecast_days: String(config.forecastDays)
    });

    pendingRequest = fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      headers: { "Accept": "application/json" },
      cache: "no-store"
    })
      .then(response => {
        if (!response.ok) throw new Error(`Meteo HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        saveCache(data);
        return data;
      })
      .finally(() => {
        pendingRequest = null;
      });

    return pendingRequest;
  }

  function hourKey(date, time) {
    const hour = String(time || "00:00").slice(0, 2).padStart(2, "0");
    return `${date}T${hour}:00`;
  }

  async function getForBooking(date, startTime, force = false) {
    if (!date || !startTime) return null;
    const data = await fetchForecast(force);
    const hourly = data?.hourly;
    if (!hourly?.time?.length) return null;

    const target = hourKey(date, startTime);
    let index = hourly.time.indexOf(target);

    if (index < 0) {
      const targetMs = new Date(target).getTime();
      let bestDiff = Infinity;
      hourly.time.forEach((value, i) => {
        const diff = Math.abs(new Date(value).getTime() - targetMs);
        if (diff < bestDiff) {
          bestDiff = diff;
          index = i;
        }
      });
      if (bestDiff > 90 * 60 * 1000) return null;
    }

    const result = {
      date,
      time: String(startTime).slice(0, 5),
      temperature: Math.round(hourly.temperature_2m?.[index] ?? 0),
      precipitationProbability: Math.round(hourly.precipitation_probability?.[index] ?? 0),
      precipitation: Number(hourly.precipitation?.[index] ?? 0),
      weatherCode: Number(hourly.weather_code?.[index] ?? -1),
      windSpeed: Math.round(hourly.wind_speed_10m?.[index] ?? 0),
      windGust: Math.round(hourly.wind_gusts_10m?.[index] ?? 0)
    };
    result.description = weatherDescription(result.weatherCode);
    result.risk = riskLevel(result);
    return result;
  }

  function compactHtml(item) {
    if (!item) return '<span class="weather-unavailable">Previsione non disponibile</span>';
    return `
      <span class="weather-summary weather-${item.risk}">
        <span class="weather-main">${item.description.icon} ${item.temperature}°C</span>
        <span>Pioggia ${item.precipitationProbability}%</span>
        <span>Vento ${item.windSpeed} km/h</span>
      </span>`;
  }

  function detailedHtml(item, customTitle = "") {
    if (!item) {
      return `<div class="weather-card weather-unknown">
        <strong>🌦️ Previsione non ancora disponibile</strong>
        <span>Le previsioni orarie sono generalmente disponibili fino a circa 16 giorni.</span>
      </div>`;
    }
    const title = customTitle || "Previsioni per il giorno di prenotazione";
    return `<div class="weather-card weather-${item.risk}">
      <div class="weather-card-title">
        <span>${item.description.icon}</span>
        <div><strong>${title}</strong><small>${item.description.label} · ${config.locationName}</small></div>
      </div>
      <div class="weather-values">
        <span><strong>${item.temperature}°C</strong> Temperatura</span>
        <span><strong>${item.precipitationProbability}%</strong> Probabilità pioggia</span>
        <span><strong>${item.windSpeed} km/h</strong> Vento</span>
        <span><strong>${item.windGust} km/h</strong> Raffiche</span>
      </div>
      <small class="weather-disclaimer">Previsione indicativa, soggetta a variazioni.</small>
    </div>`;
  }

  return {
    config,
    fetchForecast,
    getForBooking,
    compactHtml,
    detailedHtml
  };
})();
