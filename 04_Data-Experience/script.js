const TOP_N_CLASSIC = 20;
const TOP_N_PRESENTATION = 7;
const SCALER_PATH = "./weather-data/normalized/scaler_params.json";
const NORMALIZED_CSV_PATH = "./weather-data/normalized/combined_weather_normalized.csv";
const RAW_CSV_PATH = "./weather-data/combined/weather_history.csv";
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const PRESENTATION_ROW_CYCLE_MS = 900;
const PRESENTATION_HEADER_TO_BODY_MS = 400;
const PRESENTATION_SKY_REFRESH_MS = 15 * 60 * 1000;

const DAILY_FIELDS = [
  "weather_code",
  "temperature_2m_mean",
  "apparent_temperature_mean",
  "rain_sum",
  "precipitation_hours",
  "snowfall_sum",
  "daylight_duration",
  "sunshine_duration",
  "wind_gusts_10m_max",
  "wind_speed_10m_mean",
  "dew_point_2m_mean",
  "cloud_cover_mean",
  "sunrise",
  "sunset"
];

let scalerConfigCache = null;
let historyRowsCache = null;
let rawHistoryRowsCache = null;
let rawHistoryIndexCache = null;

let presentationCoords = null;
let isPresentationMode = true;
let currentUnit = "C";
let lastForecastMeta = null;
let lastPresentationRows = null;
let presentationSkyIntervalId = null;
let activeArchiveQuery = null;

/** @type {{ cities: string[], datesByCity: Map<string, string[]> } | null} */
let archivePickerModel = null;
let archivePickerReady = false;
let archivePickerListenersBound = false;

const WMO_DESCRIPTIONS = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail"
};

const modeTitle = document.getElementById("modeTitle");
const modeSuffix = document.getElementById("modeSuffix");
const presentationPanel = document.getElementById("presentationPanel");
const presentationSimilar = document.getElementById("presentationSimilar");
const classicPanel = document.getElementById("classicPanel");
const presentationNarrative = document.getElementById("presentationNarrative");
const searchHistoryButton = document.getElementById("searchHistoryButton");
const presentationCards = document.getElementById("presentationCards");
const unitToggleEl = document.getElementById("unitToggle");
const presentationSkySun = document.getElementById("presentationSkySun");
const presentationSkyMoon = document.getElementById("presentationSkyMoon");

const runButton = document.getElementById("runButton");
const statusEl = document.getElementById("status");
const resultsBody = document.querySelector("#resultsTable tbody");
const debugOutput = document.getElementById("debugOutput");
const todayWeatherCard = document.getElementById("todayWeatherCard");
const archivePickCity = document.getElementById("archivePickCity");
const archivePickYear = document.getElementById("archivePickYear");
const archivePickMonth = document.getElementById("archivePickMonth");
const archivePickDay = document.getElementById("archivePickDay");
const archivePickRun = document.getElementById("archivePickRun");

runButton.addEventListener("click", runMatcher);
searchHistoryButton.addEventListener("click", onPresentationSearchAndReveal);

modeTitle.addEventListener("click", toggleMode);
modeTitle.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleMode();
  }
});

unitToggleEl.addEventListener("click", (event) => {
  const button = event.target.closest(".unit-btn");
  if (!button) return;
  const unit = button.dataset.unit;
  if (unit !== "C" && unit !== "F") return;
  if (unit === currentUnit) return;
  setUnit(unit);
});

document.addEventListener("DOMContentLoaded", () => {
  syncPanels();
  if (isPresentationMode) {
    initPresentationWeather();
  } else {
    setStatus("Ready.");
  }
  initArchivePickerUi();
});

function syncPanels() {
  document.body.classList.toggle("mode-pres", isPresentationMode);
  document.body.classList.toggle("mode-data", !isPresentationMode);
  presentationPanel.hidden = !isPresentationMode;
  if (presentationSimilar) {
    presentationSimilar.hidden = !isPresentationMode;
  }
  classicPanel.hidden = isPresentationMode;
  modeSuffix.textContent = isPresentationMode ? " - presentation mode" : " - data mode";
  modeTitle.setAttribute("aria-pressed", String(isPresentationMode));
  if (!isPresentationMode) {
    clearPresentationSkyTheme();
  }
}

function toggleMode() {
  isPresentationMode = !isPresentationMode;
  syncPanels();
  if (isPresentationMode) {
    initPresentationWeather();
  } else {
    setStatus("Ready.");
  }
}

function setUnit(unit) {
  currentUnit = unit;
  unitToggleEl.querySelectorAll(".unit-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.unit === unit);
  });
  if (activeArchiveQuery?.rawRow) {
    presentationNarrative.innerHTML = buildPresentationNarrativeHtmlFromArchive(
      activeArchiveQuery.rawRow,
      activeArchiveQuery.dateIso,
      activeArchiveQuery.city
    );
  } else if (lastForecastMeta) {
    presentationNarrative.innerHTML = buildPresentationNarrativeHtml(
      lastForecastMeta.daily,
      lastForecastMeta
    );
  }
  if (Array.isArray(lastPresentationRows) && lastPresentationRows.length) {
    rerenderPresentationRowsKeepVisibility(lastPresentationRows);
  }
}

function rerenderPresentationRowsKeepVisibility(rows) {
  presentationCards.innerHTML = rows
    .map((row) => buildPresentationTableRowHtml(row))
    .join("");
  presentationCards
    .querySelectorAll(".presentation-reveal-cell")
    .forEach((cell) => cell.classList.add("presentation-reveal--visible"));
}

function setStatus(message) {
  statusEl.textContent = message;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function log1p(value) {
  return Math.log(1 + value);
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function asNumber(value, fallback = NaN) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value, digits = 1, fallback = "-") {
  const num = asNumber(value);
  return Number.isFinite(num) ? num.toFixed(digits) : fallback;
}

function cToF(c) {
  return (Number(c) * 9) / 5 + 32;
}

function formatTemp(celsius, digits = 1) {
  const v = Number(celsius);
  if (!Number.isFinite(v)) return "-";
  return currentUnit === "F"
    ? `${cToF(v).toFixed(digits)}°F`
    : `${v.toFixed(digits)}°C`;
}

function formatFullDate(dateStr) {
  const parts = String(dateStr).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return String(dateStr);
  }
  const [y, m, d] = parts;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return String(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function formatWeatherCode(code) {
  const intCode = Math.round(asNumber(code));
  const label = WMO_DESCRIPTIONS[intCode] || "Unknown weather";
  return `${intCode} - ${label}`;
}

function makeHistoryKey(row) {
  return [
    row.date,
    row.city,
    formatNumber(row.latitude, 5),
    formatNumber(row.longitude, 5)
  ].join("|");
}

function locationDedupeKey(row) {
  const city = String(row.city || "").trim().toLowerCase();
  if (city) {
    return `city:${city}`;
  }
  return `geo:${formatNumber(row.latitude, 2)}|${formatNumber(row.longitude, 2)}`;
}

function tempCssClass(celsius) {
  const c = asNumber(celsius);
  if (!isFiniteNumber(c)) {
    return "temp-mild";
  }
  if (c < 10) {
    return "temp-cold";
  }
  if (c > 22) {
    return "temp-warm";
  }
  return "temp-mild";
}

function skyCssClassForDaily(daily) {
  const rain = Math.max(0, asNumber(daily.rain_sum));
  const snow = Math.max(0, asNumber(daily.snowfall_sum));
  if (snow >= 0.1) {
    return "sky-rain";
  }
  if (rain >= 0.5) {
    return "sky-rain";
  }
  const code = Math.round(asNumber(daily.weather_code));
  const rainyCodes = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
  if (rainyCodes.includes(code) || rain >= 0.1) {
    return "sky-rain";
  }
  const cloud = asNumber(daily.cloud_cover_mean);
  if ([0, 1].includes(code) && isFiniteNumber(cloud) && cloud < 35) {
    return "sky-sunny";
  }
  if ([0, 1, 2].includes(code)) {
    return "sky-sunny";
  }
  return "sky-mixed";
}

function precipPhrase(daily) {
  const rain = Math.max(0, asNumber(daily.rain_sum));
  const snow = Math.max(0, asNumber(daily.snowfall_sum));
  if (snow >= 0.1) {
    return `, with about ${formatNumber(daily.snowfall_sum)} cm of snow`;
  }
  if (rain >= 1) {
    return `, with about ${formatNumber(daily.rain_sum)} mm of rain`;
  }
  if (rain >= 0.1) {
    return ", with light rain";
  }
  return ", with no significant rain or snow";
}

function buildPresentationNarrativeHtml(daily, forecastMeta) {
  const intCode = Math.round(asNumber(daily.weather_code));
  const wmoLabel = WMO_DESCRIPTIONS[intCode] || "mixed conditions";
  const wmoLower = wmoLabel.charAt(0).toLowerCase() + wmoLabel.slice(1);
  const skyClass = skyCssClassForDaily(daily);
  const tClass = tempCssClass(daily.temperature_2m_mean);
  const tempStr = formatTemp(daily.temperature_2m_mean);
  const tz = forecastMeta.timezone ? escapeHtml(String(forecastMeta.timezone)) : "your area";
  const lat = forecastMeta.latitude != null ? forecastMeta.latitude : presentationCoords?.latitude;
  const lon = forecastMeta.longitude != null ? forecastMeta.longitude : presentationCoords?.longitude;
  const locLine = isFiniteNumber(lat) && isFiniteNumber(lon)
    ? `<p class="presentation-loc">(${tz} · ${formatNumber(lat, 2)}°, ${formatNumber(lon, 2)}°)</p>`
    : `<p class="presentation-loc">(${tz})</p>`;

  return `
    <p class="presentation-lede">
      Today it is <span class="${skyClass}">${escapeHtml(wmoLower)}</span>,
      <span class="${tClass}">${escapeHtml(tempStr)}</span>${escapeHtml(precipPhrase(daily))}.
      What else happened on a day like this?
    </p>
    ${locLine}
  `;
}

function buildPresentationNarrativeHtmlFromArchive(rawRow, dateIso, cityLabel) {
  const daily = dailyLikeFromRawRow(rawRow);
  const intCode = Math.round(asNumber(daily.weather_code));
  const wmoLabel = WMO_DESCRIPTIONS[intCode] || "mixed conditions";
  const wmoLower = wmoLabel.charAt(0).toLowerCase() + wmoLabel.slice(1);
  const skyClass = skyCssClassForDaily(daily);
  const tClass = tempCssClass(daily.temperature_2m_mean);
  const tempStr = formatTemp(daily.temperature_2m_mean);
  const tz = rawRow.timezone ? escapeHtml(String(rawRow.timezone)) : "archive";
  const lat = Number(rawRow.latitude);
  const lon = Number(rawRow.longitude);
  const locLine = isFiniteNumber(lat) && isFiniteNumber(lon)
    ? `<p class="presentation-loc">(${tz} · ${formatNumber(lat, 2)}°, ${formatNumber(lon, 2)}°)</p>`
    : `<p class="presentation-loc">(${tz})</p>`;
  const place = escapeHtml(String(cityLabel || rawRow.city || ""));

  return `
    <p class="presentation-lede">
      On <strong>${escapeHtml(formatFullDate(dateIso))}</strong> in <strong>${place}</strong>,
      it was <span class="${skyClass}">${escapeHtml(wmoLower)}</span>,
      <span class="${tClass}">${escapeHtml(tempStr)}</span>${escapeHtml(precipPhrase(daily))}.
      What else happened on a day like this?
    </p>
    ${locLine}
  `;
}

async function initPresentationWeather() {
  stopPresentationSkyRefresh();
  clearPresentationSkyTheme();
  activeArchiveQuery = null;
  searchHistoryButton.disabled = true;
  presentationCards.innerHTML = "";
  lastPresentationRows = null;
  presentationNarrative.innerHTML = "<p>Locating you…</p>";
  setStatus("Getting location…");

  try {
    const position = await getCurrentPosition();
    const { latitude, longitude } = position.coords;
    presentationCoords = { latitude, longitude };
    setStatus("Fetching current weather…");
    const forecastMeta = await fetchCurrentWeather(latitude, longitude);
    lastForecastMeta = forecastMeta;
    presentationNarrative.innerHTML = buildPresentationNarrativeHtml(forecastMeta.daily, forecastMeta);
    applyPresentationSkyThemeFromMeta(forecastMeta);
    startPresentationSkyRefresh();
    searchHistoryButton.disabled = false;
    setStatus("Ready. Search through history to find similar days and reveal them.");
  } catch (error) {
    presentationCoords = null;
    lastForecastMeta = null;
    clearPresentationSkyTheme();
    presentationNarrative.innerHTML = `<p class="presentation-error">${escapeHtml(error.message)}</p>`;
    setStatus(`Error: ${error.message}`);
  }
}

async function onPresentationSearchAndReveal() {
  if (!presentationCoords && !activeArchiveQuery) {
    setStatus("Location is not available yet.");
    return;
  }

  searchHistoryButton.disabled = true;
  presentationCards.innerHTML = "";
  lastPresentationRows = null;
  setStatus("Loading archive, matching, and revealing…");

  try {
    const result = activeArchiveQuery
      ? await runSimilarityFromArchiveRow({
          city: activeArchiveQuery.city,
          dateIso: activeArchiveQuery.dateIso,
          topN: TOP_N_PRESENTATION,
          dedupeByLocation: true,
          setStatusMessages: false
        })
      : await runSimilarityPipeline({
          latitude: presentationCoords.latitude,
          longitude: presentationCoords.longitude,
          topN: TOP_N_PRESENTATION,
          dedupeByLocation: true
        });
    const rows = result.nearest;
    if (!rows.length) {
      setStatus("No similar days found.");
      return;
    }
    if (activeArchiveQuery) {
      renderPresentationArchiveQuery(result, activeArchiveQuery.city, activeArchiveQuery.dateIso, false);
    }
    lastPresentationRows = rows;
    revealPresentationRows(rows);
    setStatus(`Done. Showing ${rows.length} similar days (one row per city / location).`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    searchHistoryButton.disabled = false;
  }
}

function revealPresentationRows(rows) {
  presentationCards.innerHTML = "";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  rows.forEach((row) => {
    presentationCards.insertAdjacentHTML("beforeend", buildPresentationTableRowHtml(row));
  });

  const rowEls = Array.from(presentationCards.querySelectorAll("tr"));

  if (reducedMotion) {
    rowEls.forEach((tr) => {
      tr.querySelectorAll(".presentation-reveal-cell").forEach((cell) => {
        cell.classList.add("presentation-reveal--visible");
      });
    });
    return;
  }

  rowEls.forEach((tr, index) => {
    const headAt = index * PRESENTATION_ROW_CYCLE_MS;
    const bodyAt = index * PRESENTATION_ROW_CYCLE_MS + PRESENTATION_HEADER_TO_BODY_MS;
    window.setTimeout(() => {
      tr.querySelectorAll("td.pres-phase1").forEach((cell) => {
        cell.classList.add("presentation-reveal--visible");
      });
    }, headAt);
    window.setTimeout(() => {
      tr.querySelectorAll("td.pres-phase2").forEach((cell) => {
        cell.classList.add("presentation-reveal--visible");
      });
    }, bodyAt);
  });
}

function buildPresentationTableRowHtml(row) {
  const locText = `${escapeHtml(row.city)} · ${formatNumber(row.latitude, 1)}°, ${formatNumber(row.longitude, 1)}°`;
  return `
    <tr>
      <td class="pres-phase1 presentation-reveal-cell">${escapeHtml(formatFullDate(row.date))}</td>
      <td class="pres-phase1 presentation-reveal-cell presentation-cell--loc">${locText}</td>
      <td class="pres-phase2 presentation-reveal-cell"><span class="${tempCssClass(row.temp_mean_c)}">${formatTemp(row.temp_mean_c)}</span></td>
    </tr>
  `;
}

async function runMatcher() {
  runButton.disabled = true;
  resultsBody.innerHTML = "";
  todayWeatherCard.textContent = "Loading...";
  setStatus("Getting location...");

  try {
    const position = await getCurrentPosition();
    const { latitude, longitude } = position.coords;

    setStatus("Loading scaler and archive data...");
    const result = await runSimilarityPipeline({
      latitude,
      longitude,
      topN: TOP_N_CLASSIC,
      dedupeByLocation: false
    });

    renderTodayWeather(result.liveDaily, latitude, longitude);
    renderResults(result.nearest);
    renderDebug(
      result.engineered,
      result.liveVector,
      result.featureCols,
      latitude,
      longitude
    );
    setStatus(`Done. Found ${result.nearest.length} similar days.`);
  } catch (error) {
    todayWeatherCard.textContent = "Unable to load today's weather.";
    setStatus(`Error: ${error.message}`);
  } finally {
    runButton.disabled = false;
  }
}

async function runSimilarityPipeline({ latitude, longitude, topN, dedupeByLocation = true }) {
  const [scalerConfig, historyRows, rawHistoryRows] = await Promise.all([
    loadScalerConfig(),
    loadHistoryRows(),
    loadRawHistoryRows()
  ]);

  validateScalerConfig(scalerConfig);
  validateHistorySchema(historyRows, scalerConfig.feature_cols);
  validateRawHistorySchema(rawHistoryRows);

  setStatus("Fetching current weather...");
  const forecastMeta = await fetchCurrentWeather(latitude, longitude);
  const liveDaily = forecastMeta.daily;
  const engineered = engineerLiveFeatures(liveDaily, scalerConfig.wmoBuckets);
  const liveVector = normalizeLiveVector(engineered, scalerConfig);

  setStatus("Calculating nearest historical days...");
  const nearest = getNearestRows(liveVector, historyRows, scalerConfig.feature_cols, topN, dedupeByLocation);
  const nearestWithRaw = attachRawHistoryFields(nearest);

  return {
    liveDaily,
    forecastMeta,
    engineered,
    liveVector,
    nearest: nearestWithRaw,
    featureCols: scalerConfig.feature_cols,
    latitude,
    longitude
  };
}

function dailyFromRawForEngineering(rawRow) {
  return {
    weather_code: rawRow.weather_code,
    temperature_2m_mean: rawRow.temp_mean_c,
    apparent_temperature_mean: rawRow.apparent_temp_mean_c,
    rain_sum: rawRow.rain_sum_mm,
    snowfall_sum: rawRow.snowfall_sum_cm,
    precipitation_hours: rawRow.precipitation_hours,
    daylight_duration: rawRow.daylight_duration_s,
    sunshine_duration: rawRow.sunshine_duration_s,
    wind_gusts_10m_max: rawRow.wind_gusts_max_kmh,
    wind_speed_10m_mean: rawRow.wind_speed_mean_kmh,
    dew_point_2m_mean: rawRow.dewpoint_mean_c,
    cloud_cover_mean: rawRow.cloud_cover_mean_pct
  };
}

function dailyLikeFromRawRow(rawRow) {
  return dailyFromRawForEngineering(rawRow);
}

function getRawRowForNormalizedQuery(queryRow) {
  const key = makeHistoryKey(queryRow);
  return rawHistoryIndexCache ? rawHistoryIndexCache.get(key) : null;
}

function forecastMetaFromRawRow(rawRow, dateIso) {
  const lat = Number(rawRow.latitude);
  const lon = Number(rawRow.longitude);
  const daily = dailyLikeFromRawRow(rawRow);
  daily.sunrise = `${dateIso}T07:15:00`;
  daily.sunset = `${dateIso}T18:45:00`;
  return {
    daily,
    timezone: String(rawRow.timezone || ""),
    latitude: lat,
    longitude: lon,
    utc_offset_seconds: 0
  };
}

function renderPresentationArchiveQuery(result, city, dateIso, revealRows = true) {
  activeArchiveQuery = {
    city,
    dateIso,
    rawRow: result.rawRow
  };
  presentationCoords = {
    latitude: Number(result.rawRow.latitude),
    longitude: Number(result.rawRow.longitude)
  };
  lastForecastMeta = forecastMetaFromRawRow(result.rawRow, dateIso);
  presentationNarrative.innerHTML = buildPresentationNarrativeHtmlFromArchive(
    result.rawRow,
    dateIso,
    city
  );
  applyPresentationSkyThemeFromMeta(lastForecastMeta);
  startPresentationSkyRefresh();
  lastPresentationRows = result.nearest;
  presentationCards.innerHTML = "";
  if (revealRows && result.nearest.length) {
    revealPresentationRows(result.nearest);
  }
}

async function runSimilarityFromArchiveRow({
  city,
  dateIso,
  topN,
  dedupeByLocation,
  setStatusMessages = true
}) {
  if (setStatusMessages) {
    setStatus("Loading scaler and archive data...");
  }
  const [scalerConfig, historyRows] = await Promise.all([loadScalerConfig(), loadHistoryRows()]);
  await loadRawHistoryRows();

  validateScalerConfig(scalerConfig);
  validateHistorySchema(historyRows, scalerConfig.feature_cols);
  validateRawHistorySchema(rawHistoryRowsCache);

  const cityNorm = String(city || "").trim();
  const dateNorm = String(dateIso || "").trim();
  const queryRow = historyRows.find(
    (r) => String(r.city || "").trim() === cityNorm && String(r.date || "").trim() === dateNorm
  );
  if (!queryRow) {
    throw new Error(`No dataset row for "${cityNorm}" on ${dateNorm}.`);
  }

  const featureCols = scalerConfig.feature_cols;
  const liveVector = featureCols.map((col) => {
    const v = Number(queryRow[col]);
    if (!isFiniteNumber(v)) {
      throw new Error(`Archive row has invalid feature "${col}".`);
    }
    return v;
  });

  const rawRow = getRawRowForNormalizedQuery(queryRow);
  if (!rawRow) {
    throw new Error("Raw weather row missing for this archive entry (date / city mismatch in CSVs).");
  }
  const engineered = engineerLiveFeatures(dailyFromRawForEngineering(rawRow), scalerConfig.wmoBuckets);

  if (setStatusMessages) {
    setStatus("Calculating nearest historical days...");
  }
  const excludeKey = makeHistoryKey(queryRow);
  const nearest = getNearestRows(
    liveVector,
    historyRows,
    featureCols,
    topN,
    dedupeByLocation,
    excludeKey
  );
  const nearestWithRaw = attachRawHistoryFields(nearest);

  return {
    queryRow,
    rawRow,
    engineered,
    liveVector,
    nearest: nearestWithRaw,
    featureCols
  };
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error("Location access was denied."));
          return;
        }
        reject(new Error("Unable to determine current location."));
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    );
  });
}

async function fetchCurrentWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: DAILY_FIELDS.join(","),
    forecast_days: "1",
    timezone: "auto"
  });
  const response = await fetch(`${OPEN_METEO_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed (${response.status}).`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.reason || "Open-Meteo returned an error.");
  }
  if (!payload.daily || !Array.isArray(payload.daily.time) || payload.daily.time.length === 0) {
    throw new Error("Open-Meteo response missing daily weather data.");
  }

  const daily = {};
  for (const key of Object.keys(payload.daily)) {
    const value = payload.daily[key];
    daily[key] = Array.isArray(value) ? value[0] : value;
  }

  const utcOffsetSeconds =
    payload.utc_offset_seconds != null && Number.isFinite(Number(payload.utc_offset_seconds))
      ? Number(payload.utc_offset_seconds)
      : 0;

  return {
    daily,
    timezone: payload.timezone != null ? String(payload.timezone) : "",
    latitude: payload.latitude != null ? Number(payload.latitude) : lat,
    longitude: payload.longitude != null ? Number(payload.longitude) : lon,
    utc_offset_seconds: utcOffsetSeconds
  };
}

/** Open-Meteo daily sunrise/sunset are local wall times; DST transition days may be ~1h off. */
function parseOpenMeteoLocalInstant(isoStr, utcOffsetSeconds) {
  const m = String(isoStr).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = m[6] != null ? Number(m[6]) : 0;
  if (![y, mo, d, h, mi].every((n) => Number.isFinite(n))) return NaN;
  const sec = Number.isFinite(s) ? s : 0;
  return Date.UTC(y, mo - 1, d, h, mi, sec) - utcOffsetSeconds * 1000;
}

function isDayLocalHeuristic(utcOffsetSeconds) {
  if (!Number.isFinite(utcOffsetSeconds)) return true;
  const shifted = new Date(Date.now() + utcOffsetSeconds * 1000);
  const hour = shifted.getUTCHours();
  return hour >= 6 && hour < 18;
}

function rgbToCss(rgb) {
  return `rgb(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)})`;
}

function lerpRgb(a, b, t) {
  const u = clamp(t, 0, 1);
  return {
    r: a.r + (b.r - a.r) * u,
    g: a.g + (b.g - a.g) * u,
    b: a.b + (b.b - a.b) * u
  };
}

function mixTowardWhite(rgb, amount) {
  const w = { r: 255, g: 255, b: 255 };
  return lerpRgb(rgb, w, amount);
}

function vec3TupleToRgb(bottomVec) {
  return {
    r: bottomVec[0],
    g: bottomVec[1],
    b: bottomVec[2]
  };
}

function fallbackPresentationGradients(isDay) {
  const nightA = { r: 15, g: 24, b: 41 };
  const nightB = { r: 30, g: 58, b: 95 };
  const dayA = { r: 110, g: 190, b: 245 };
  const dayB = { r: 200, g: 230, b: 255 };
  if (isDay) {
    const skyGradient = `linear-gradient(to bottom, ${rgbToCss(dayA)} 0%, ${rgbToCss(dayB)} 100%)`;
    const storyGradient = `linear-gradient(135deg, rgba(255,255,255,0.97) 0%, ${rgbToCss(mixTowardWhite(dayB, 0.88))} 100%)`;
    return { skyGradient, storyGradient };
  }
  const skyGradient = `linear-gradient(to bottom, ${rgbToCss(nightA)} 0%, ${rgbToCss(nightB)} 100%)`;
  const storyGradient =
    "linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(232,240,252,1) 100%)";
  return { skyGradient, storyGradient };
}

function computePresentationSkyState(nowMs, sunriseMs, sunsetMs, utcOffsetSeconds, latitude, longitude) {
  const invalidTimes =
    !Number.isFinite(sunriseMs) ||
    !Number.isFinite(sunsetMs) ||
    !Number.isFinite(nowMs) ||
    sunriseMs >= sunsetMs;

  let isDay;
  if (invalidTimes) {
    isDay = isDayLocalHeuristic(utcOffsetSeconds);
    const { skyGradient, storyGradient } = fallbackPresentationGradients(isDay);
    return { isDay, skyGradient, storyGradient };
  }

  isDay = nowMs > sunriseMs && nowMs < sunsetMs;

  const lat = Number(latitude);
  const lon = Number(longitude);
  const canUseHorizon =
    typeof globalThis.renderHorizonGradient === "function" &&
    typeof globalThis.getSolarAltitudeRadians === "function" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon);

  if (canUseHorizon) {
    const alt = globalThis.getSolarAltitudeRadians(new Date(nowMs), lat, lon);
    if (Number.isFinite(alt)) {
      const out = globalThis.renderHorizonGradient(alt);
      const skyGradient = out[0];
      const bottomRgb = vec3TupleToRgb(out[2]);
      const storyEnd = mixTowardWhite(bottomRgb, 0.82);
      const storyGradient = `linear-gradient(135deg, rgba(255,255,255,0.96) 0%, ${rgbToCss(storyEnd)} 100%)`;
      return { isDay, skyGradient, storyGradient };
    }
  }

  const { skyGradient, storyGradient } = fallbackPresentationGradients(isDay);
  return { isDay, skyGradient, storyGradient };
}

function applyPresentationSkyThemeFromMeta(forecastMeta) {
  if (!isPresentationMode || !forecastMeta) return;

  const offset = forecastMeta.utc_offset_seconds;
  const daily = forecastMeta.daily;
  const sunriseStr = daily.sunrise != null ? String(daily.sunrise) : "";
  const sunsetStr = daily.sunset != null ? String(daily.sunset) : "";
  const sunriseMs = parseOpenMeteoLocalInstant(sunriseStr, offset);
  const sunsetMs = parseOpenMeteoLocalInstant(sunsetStr, offset);
  const lat =
    forecastMeta.latitude != null ? Number(forecastMeta.latitude) : presentationCoords?.latitude;
  const lon =
    forecastMeta.longitude != null ? Number(forecastMeta.longitude) : presentationCoords?.longitude;
  const state = computePresentationSkyState(Date.now(), sunriseMs, sunsetMs, offset, lat, lon);

  document.body.style.setProperty("--pres-sky-gradient", state.skyGradient);
  document.body.style.setProperty("--pres-story-gradient", state.storyGradient);
  document.body.classList.toggle("pres-sky--day", state.isDay);
  document.body.classList.toggle("pres-sky--night", !state.isDay);

  if (presentationSkySun) {
    presentationSkySun.hidden = !state.isDay;
  }
  if (presentationSkyMoon) {
    presentationSkyMoon.hidden = state.isDay;
  }
}

function clearPresentationSkyTheme() {
  stopPresentationSkyRefresh();
  document.body.style.removeProperty("--pres-sky-gradient");
  document.body.style.removeProperty("--pres-story-gradient");
  document.body.classList.remove("pres-sky--day", "pres-sky--night");
  if (presentationSkySun) {
    presentationSkySun.hidden = true;
  }
  if (presentationSkyMoon) {
    presentationSkyMoon.hidden = true;
  }
}

function stopPresentationSkyRefresh() {
  if (presentationSkyIntervalId != null) {
    clearInterval(presentationSkyIntervalId);
    presentationSkyIntervalId = null;
  }
}

function startPresentationSkyRefresh() {
  stopPresentationSkyRefresh();
  if (!isPresentationMode || !lastForecastMeta) return;
  presentationSkyIntervalId = window.setInterval(() => {
    if (!isPresentationMode || !lastForecastMeta) {
      stopPresentationSkyRefresh();
      return;
    }
    applyPresentationSkyThemeFromMeta(lastForecastMeta);
  }, PRESENTATION_SKY_REFRESH_MS);
}

function engineerLiveFeatures(daily, wmoBuckets) {
  const weatherCode = Number(daily.weather_code);
  const bucketValue = wmoBuckets[String(weatherCode)];
  const weatherCodeBucket = Number.isFinite(bucketValue) ? bucketValue : 1;

  const rain = Math.max(0, Number(daily.rain_sum));
  const snowfall = Math.max(0, Number(daily.snowfall_sum));
  const precipitationHours = Math.max(0, Number(daily.precipitation_hours));
  const daylight = Number(daily.daylight_duration);
  const sunshine = Math.max(0, Number(daily.sunshine_duration));
  const sunshineFraction = daylight > 0 ? clamp(sunshine / daylight, 0, 1) : 0;

  return {
    temperature_2m_mean: Number(daily.temperature_2m_mean),
    apparent_temperature_mean: Number(daily.apparent_temperature_mean),
    dewpoint_mean_c: Number(daily.dew_point_2m_mean),
    rain_sum_log1p: log1p(rain),
    snowfall_sum_log1p: log1p(snowfall),
    precipitation_hours: precipitationHours,
    sunshine_fraction: sunshineFraction,
    cloud_cover_mean_pct: clamp(Number(daily.cloud_cover_mean), 0, 100),
    wind_speed_mean_kmh: Math.max(0, Number(daily.wind_speed_10m_mean)),
    wind_gusts_max_kmh: Math.max(0, Number(daily.wind_gusts_10m_max)),
    weather_code_bucket: Number(weatherCodeBucket)
  };
}

function normalizeLiveVector(engineered, scalerConfig) {
  const { feature_cols: featureCols, center, scale, weights } = scalerConfig;
  const vector = [];

  for (let i = 0; i < featureCols.length; i += 1) {
    const col = featureCols[i];
    const rawValue = engineered[col];
    const centerValue = Number(center[i]);
    const scaleValue = Number(scale[i]);
    const weightValue = Number(weights[col]);

    if (!isFiniteNumber(rawValue)) {
      throw new Error(`Live feature "${col}" is not finite.`);
    }
    if (!isFiniteNumber(centerValue) || !isFiniteNumber(scaleValue) || scaleValue === 0) {
      throw new Error(`Scaler values for "${col}" are invalid.`);
    }
    if (!isFiniteNumber(weightValue)) {
      throw new Error(`Weight for "${col}" is invalid.`);
    }

    const scaled = (rawValue - centerValue) / scaleValue;
    vector.push(scaled * weightValue);
  }

  return vector;
}

function euclideanDistance(vecA, vecB) {
  let sum = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    const diff = vecA[i] - vecB[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function getNearestRows(
  liveVector,
  historyRows,
  featureCols,
  topN,
  dedupeByLocation = true,
  excludeHistoryKey = null
) {
  const scored = [];

  for (const row of historyRows) {
    if (excludeHistoryKey && makeHistoryKey(row) === excludeHistoryKey) {
      continue;
    }
    const histVector = featureCols.map((col) => Number(row[col]));
    if (!histVector.every(isFiniteNumber)) {
      continue;
    }

    scored.push({
      date: row.date,
      city: row.city,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      distance: euclideanDistance(liveVector, histVector)
    });
  }

  scored.sort((a, b) => a.distance - b.distance);

  if (!dedupeByLocation) {
    return scored.slice(0, topN);
  }

  const seenLocation = new Set();
  const uniqueByLocation = [];
  for (const row of scored) {
    const key = locationDedupeKey(row);
    if (seenLocation.has(key)) {
      continue;
    }
    seenLocation.add(key);
    uniqueByLocation.push(row);
    if (uniqueByLocation.length >= topN) {
      break;
    }
  }
  return uniqueByLocation;
}

function attachRawHistoryFields(rows) {
  const index = rawHistoryIndexCache || new Map();
  return rows.map((row) => {
    const key = makeHistoryKey(row);
    const rawRow = index.get(key);
    return {
      ...row,
      weather_code: rawRow ? rawRow.weather_code : "",
      temp_mean_c: rawRow ? rawRow.temp_mean_c : "",
      apparent_temp_mean_c: rawRow ? rawRow.apparent_temp_mean_c : "",
      rain_sum_mm: rawRow ? rawRow.rain_sum_mm : "",
      snowfall_sum_cm: rawRow ? rawRow.snowfall_sum_cm : "",
      precipitation_hours: rawRow ? rawRow.precipitation_hours : "",
      wind_speed_mean_kmh: rawRow ? rawRow.wind_speed_mean_kmh : "",
      wind_gusts_max_kmh: rawRow ? rawRow.wind_gusts_max_kmh : "",
      cloud_cover_mean_pct: rawRow ? rawRow.cloud_cover_mean_pct : ""
    };
  });
}

function renderTodayWeather(daily, latitude, longitude) {
  const date = daily.time || new Date().toISOString().slice(0, 10);
  const html = `
    <div class="today-grid">
      <p><strong>Date:</strong> ${date}</p>
      <p><strong>Location:</strong> ${formatNumber(latitude, 4)}, ${formatNumber(longitude, 4)}</p>
      <p><strong>Weather:</strong> ${formatWeatherCode(daily.weather_code)}</p>
      <p><strong>Temp:</strong> ${formatNumber(daily.temperature_2m_mean)} C</p>
      <p><strong>Feels Like:</strong> ${formatNumber(daily.apparent_temperature_mean)} C</p>
      <p><strong>Rain:</strong> ${formatNumber(daily.rain_sum)} mm</p>
      <p><strong>Snow:</strong> ${formatNumber(daily.snowfall_sum)} cm</p>
      <p><strong>Precip Hours:</strong> ${formatNumber(daily.precipitation_hours)} h</p>
      <p><strong>Wind:</strong> ${formatNumber(daily.wind_speed_10m_mean)} km/h</p>
      <p><strong>Gust:</strong> ${formatNumber(daily.wind_gusts_10m_max)} km/h</p>
      <p><strong>Cloud Cover:</strong> ${formatNumber(daily.cloud_cover_mean)} %</p>
      <p><strong>Dew Point:</strong> ${formatNumber(daily.dew_point_2m_mean)} C</p>
      <p><strong>Sunshine:</strong> ${formatNumber(daily.sunshine_duration, 0)} s</p>
      <p><strong>Daylight:</strong> ${formatNumber(daily.daylight_duration, 0)} s</p>
    </div>
  `;
  todayWeatherCard.innerHTML = html;
}

function renderResults(rows) {
  if (!rows.length) {
    setStatus("No valid historical rows available after filtering.");
    return;
  }

  const html = rows.map((row, index) => (
    `<tr>
      <td>${index + 1}</td>
      <td>${row.date}</td>
      <td>${row.city}</td>
      <td>${formatWeatherCode(row.weather_code)}</td>
      <td>${formatNumber(row.temp_mean_c)}</td>
      <td>${formatNumber(row.apparent_temp_mean_c)}</td>
      <td>${formatNumber(row.rain_sum_mm)}</td>
      <td>${formatNumber(row.snowfall_sum_cm)}</td>
      <td>${formatNumber(row.precipitation_hours)}</td>
      <td>${formatNumber(row.wind_speed_mean_kmh)}</td>
      <td>${formatNumber(row.wind_gusts_max_kmh)}</td>
      <td>${formatNumber(row.cloud_cover_mean_pct)}</td>
      <td>${row.distance.toFixed(4)}</td>
    </tr>`
  )).join("");

  resultsBody.innerHTML = html;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function renderDebug(engineered, vector, featureCols, lat, lon) {
  const parts = [
    `Latitude: ${lat}`,
    `Longitude: ${lon}`,
    "",
    "Engineered features:"
  ];

  for (const key of Object.keys(engineered)) {
    parts.push(`  ${key}: ${engineered[key]}`);
  }

  parts.push("", "Normalized vector:");
  featureCols.forEach((col, idx) => {
    parts.push(`  ${col}: ${vector[idx]}`);
  });

  debugOutput.textContent = parts.join("\n");
}

async function loadScalerConfig() {
  if (scalerConfigCache) {
    return scalerConfigCache;
  }
  const response = await fetch(SCALER_PATH);
  if (!response.ok) {
    throw new Error(`Could not load scaler JSON at ${SCALER_PATH}.`);
  }
  scalerConfigCache = await response.json();
  return scalerConfigCache;
}

async function loadHistoryRows() {
  if (historyRowsCache) {
    return historyRowsCache;
  }
  const response = await fetch(NORMALIZED_CSV_PATH);
  if (!response.ok) {
    throw new Error(`Could not load normalized CSV at ${NORMALIZED_CSV_PATH}.`);
  }
  const csvText = await response.text();
  historyRowsCache = parseCsv(csvText);
  return historyRowsCache;
}

async function loadRawHistoryRows() {
  if (rawHistoryRowsCache && rawHistoryIndexCache) {
    return rawHistoryRowsCache;
  }
  const response = await fetch(RAW_CSV_PATH);
  if (!response.ok) {
    throw new Error(`Could not load raw history CSV at ${RAW_CSV_PATH}.`);
  }
  const csvText = await response.text();
  rawHistoryRowsCache = parseCsv(csvText);
  rawHistoryIndexCache = new Map(rawHistoryRowsCache.map((row) => [makeHistoryKey(row), row]));
  return rawHistoryRowsCache;
}

function parseCsv(csvText) {
  const lines = splitCsvLines(csvText);
  if (lines.length < 2) {
    throw new Error("CSV is empty or invalid.");
  }

  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    if (values.length !== headers.length) {
      continue;
    }
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx];
    });
    rows.push(row);
  }
  return rows;
}

function splitCsvLines(text) {
  const lines = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function validateScalerConfig(config) {
  const keys = ["feature_cols", "weights", "center", "scale", "wmoBuckets"];
  for (const key of keys) {
    if (!(key in config)) {
      throw new Error(`Scaler config missing "${key}".`);
    }
  }
  if (!Array.isArray(config.feature_cols) || !config.feature_cols.length) {
    throw new Error("feature_cols must be a non-empty array.");
  }
  if (!Array.isArray(config.center) || !Array.isArray(config.scale)) {
    throw new Error("center and scale must be arrays.");
  }
  if (config.feature_cols.length !== config.center.length || config.feature_cols.length !== config.scale.length) {
    throw new Error("feature_cols, center, and scale lengths do not match.");
  }
}

function validateHistorySchema(rows, featureCols) {
  if (!rows.length) {
    throw new Error("No historical rows were parsed from normalized CSV.");
  }
  const requiredMeta = ["date", "city", "latitude", "longitude"];
  const sample = rows[0];
  const required = requiredMeta.concat(featureCols);
  const missing = required.filter((col) => !(col in sample));
  if (missing.length) {
    throw new Error(`Normalized CSV missing required columns: ${missing.join(", ")}`);
  }
}

function validateRawHistorySchema(rows) {
  if (!rows.length) {
    throw new Error("No rows were parsed from raw history CSV.");
  }
  const required = [
    "date",
    "city",
    "latitude",
    "longitude",
    "weather_code",
    "temp_mean_c",
    "apparent_temp_mean_c",
    "rain_sum_mm",
    "snowfall_sum_cm",
    "precipitation_hours",
    "wind_speed_mean_kmh",
    "wind_gusts_max_kmh",
    "cloud_cover_mean_pct"
  ];
  const sample = rows[0];
  const missing = required.filter((col) => !(col in sample));
  if (missing.length) {
    throw new Error(`Raw CSV missing required columns: ${missing.join(", ")}`);
  }
}

const ARCHIVE_MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

function archiveMonthLabel(mm) {
  const n = Number(mm);
  return ARCHIVE_MONTH_LABELS[n - 1] || String(mm);
}

function buildArchivePickerModel(historyRows) {
  const dateSetByCity = new Map();
  for (const row of historyRows) {
    const c = String(row.city || "").trim();
    const d = String(row.date || "").trim();
    if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      continue;
    }
    if (!dateSetByCity.has(c)) {
      dateSetByCity.set(c, new Set());
    }
    dateSetByCity.get(c).add(d);
  }
  const cities = Array.from(dateSetByCity.keys()).sort((a, b) => a.localeCompare(b));
  const datesByCity = new Map();
  for (const city of cities) {
    datesByCity.set(city, Array.from(dateSetByCity.get(city)).sort());
  }
  return { cities, datesByCity };
}

function fillSelectOptions(select, values, labelFn = null) {
  select.innerHTML = "";
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = labelFn ? labelFn(v) : String(v);
    select.appendChild(opt);
  }
}

function archivePickerRefreshFromCity() {
  if (!archivePickerModel) {
    return;
  }
  const city = archivePickCity.value;
  const dates = archivePickerModel.datesByCity.get(city) || [];
  const years = [...new Set(dates.map((d) => d.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
  fillSelectOptions(archivePickYear, years);
  archivePickYear.value = years[0] || "";
  archivePickerRefreshFromYear();
}

function archivePickerRefreshFromYear() {
  if (!archivePickerModel) {
    return;
  }
  const city = archivePickCity.value;
  const dates = archivePickerModel.datesByCity.get(city) || [];
  const y = archivePickYear.value;
  const prevM = archivePickMonth.value;
  const months = [...new Set(dates.filter((d) => d.startsWith(`${y}-`)).map((d) => d.slice(5, 7)))].sort(
    (a, b) => Number(a) - Number(b)
  );
  fillSelectOptions(archivePickMonth, months, archiveMonthLabel);
  archivePickMonth.value = months.includes(prevM) ? prevM : months[0] || "";
  archivePickerRefreshFromMonth();
}

function archivePickerRefreshFromMonth() {
  if (!archivePickerModel) {
    return;
  }
  const city = archivePickCity.value;
  const dates = archivePickerModel.datesByCity.get(city) || [];
  const y = archivePickYear.value;
  const m = archivePickMonth.value;
  const prevD = archivePickDay.value;
  const prefix = `${y}-${m}-`;
  const days = [...new Set(dates.filter((d) => d.startsWith(prefix)).map((d) => d.slice(8, 10)))].sort(
    (a, b) => Number(a) - Number(b)
  );
  fillSelectOptions(archivePickDay, days, (dd) => String(Number(dd)));
  archivePickDay.value = days.includes(prevD) ? prevD : days[0] || "";
}

function archivePickerSetEnabled(enabled) {
  [archivePickCity, archivePickYear, archivePickMonth, archivePickDay, archivePickRun].forEach((el) => {
    if (el) {
      el.disabled = !enabled;
    }
  });
}

async function initArchivePickerUi() {
  if (!archivePickCity || !archivePickYear || !archivePickMonth || !archivePickDay || !archivePickRun) {
    return;
  }
  archivePickerSetEnabled(false);
  archivePickRun.textContent = "Loading archive…";
  try {
    const rows = await loadHistoryRows();
    archivePickerModel = buildArchivePickerModel(rows);
    if (!archivePickerModel.cities.length) {
      archivePickRun.textContent = "No locations";
      return;
    }
    fillSelectOptions(archivePickCity, archivePickerModel.cities);
    archivePickerRefreshFromCity();
    archivePickerReady = true;
    archivePickRun.textContent = "Find similar days";
    archivePickerSetEnabled(true);

    if (!archivePickerListenersBound) {
      archivePickerListenersBound = true;
      archivePickCity.addEventListener("change", archivePickerRefreshFromCity);
      archivePickYear.addEventListener("change", archivePickerRefreshFromYear);
      archivePickMonth.addEventListener("change", archivePickerRefreshFromMonth);
      archivePickRun.addEventListener("click", onArchivePickerSubmit);
    }
  } catch (err) {
    archivePickRun.textContent = "Archive failed to load";
    console.error(err);
  }
}

async function onArchivePickerSubmit() {
  if (!archivePickerReady || !archivePickerModel) {
    return;
  }
  const city = archivePickCity.value;
  const y = archivePickYear.value;
  const m = archivePickMonth.value;
  const d = String(archivePickDay.value || "").padStart(2, "0");
  const dateIso = `${y}-${m}-${d}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    if (!isPresentationMode) {
      setStatus("Pick a valid date.");
    }
    return;
  }

  archivePickRun.disabled = true;
  try {
    if (isPresentationMode) {
      const result = await runSimilarityFromArchiveRow({
        city,
        dateIso,
        topN: TOP_N_PRESENTATION,
        dedupeByLocation: true,
        setStatusMessages: false
      });
      renderPresentationArchiveQuery(result, city, dateIso, true);
    } else {
      const result = await runSimilarityFromArchiveRow({
        city,
        dateIso,
        topN: TOP_N_CLASSIC,
        dedupeByLocation: false,
        setStatusMessages: true
      });
      const daily = dailyLikeFromRawRow(result.rawRow);
      daily.time = dateIso;
      renderTodayWeather(daily, Number(result.queryRow.latitude), Number(result.queryRow.longitude));
      renderResults(result.nearest);
      renderDebug(
        result.engineered,
        result.liveVector,
        result.featureCols,
        Number(result.queryRow.latitude),
        Number(result.queryRow.longitude)
      );
      setStatus(`Similar days for ${city} on ${dateIso}.`);
    }
  } catch (error) {
    if (isPresentationMode) {
      presentationNarrative.innerHTML = `<p class="presentation-error">${escapeHtml(error.message)}</p>`;
    } else {
      setStatus(`Error: ${error.message}`);
    }
  } finally {
    archivePickRun.disabled = false;
  }
}
