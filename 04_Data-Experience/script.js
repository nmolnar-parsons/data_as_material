const TOP_N_CLASSIC = 5;
const ARTICLE_LOOKUP_CLASSIC = TOP_N_CLASSIC;
const TOP_N_PRESENTATION = 7;
const ARTICLE_LOOKUP_PRESENTATION = TOP_N_PRESENTATION;
const SCALER_PATH = "./weather-data/normalized/scaler_params.json";
const NORMALIZED_CSV_PATH = "./weather-data/normalized/combined_weather_normalized.csv";
const RAW_CSV_PATH = "./weather-data/combined/weather_history.csv";
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const PRESENTATION_ROW_CYCLE_MS = 900;
const PRESENTATION_HEADER_TO_BODY_MS = 400;

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
  "cloud_cover_mean"
];

let scalerConfigCache = null;
let historyRowsCache = null;
let rawHistoryRowsCache = null;
let rawHistoryIndexCache = null;

let presentationCoords = null;

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

const presentationModeToggle = document.getElementById("presentationModeToggle");
const presentationPanel = document.getElementById("presentationPanel");
const classicPanel = document.getElementById("classicPanel");
const presentationStory = document.getElementById("presentationStory");
const searchHistoryButton = document.getElementById("searchHistoryButton");
const presentationCards = document.getElementById("presentationCards");

const runButton = document.getElementById("runButton");
const statusEl = document.getElementById("status");
const resultsBody = document.querySelector("#resultsTable tbody");
const debugOutput = document.getElementById("debugOutput");
const todayWeatherCard = document.getElementById("todayWeatherCard");

runButton.addEventListener("click", runMatcher);
searchHistoryButton.addEventListener("click", onPresentationSearchAndReveal);
presentationModeToggle.addEventListener("change", onPresentationModeChange);

document.addEventListener("DOMContentLoaded", () => {
  syncPanelsFromToggle();
  if (presentationModeToggle.checked) {
    initPresentationWeather();
  } else {
    setStatus("Ready.");
  }
});

function syncPanelsFromToggle() {
  const pres = presentationModeToggle.checked;
  presentationPanel.hidden = !pres;
  classicPanel.hidden = pres;
}

function onPresentationModeChange() {
  syncPanelsFromToggle();
  if (presentationModeToggle.checked) {
    initPresentationWeather();
  } else {
    setStatus("Ready.");
  }
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
  const tempStr = `${formatNumber(daily.temperature_2m_mean)}°C`;
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

async function initPresentationWeather() {
  searchHistoryButton.disabled = true;
  presentationCards.innerHTML = "";
  presentationStory.innerHTML = "<p>Locating you…</p>";
  setStatus("Getting location…");

  try {
    const position = await getCurrentPosition();
    const { latitude, longitude } = position.coords;
    presentationCoords = { latitude, longitude };
    setStatus("Fetching current weather…");
    const forecastMeta = await fetchCurrentWeather(latitude, longitude);
    presentationStory.innerHTML = buildPresentationNarrativeHtml(forecastMeta.daily, forecastMeta);
    searchHistoryButton.disabled = false;
    setStatus("Ready. Search through history to find similar days and reveal them.");
  } catch (error) {
    presentationCoords = null;
    presentationStory.innerHTML = `<p class="presentation-error">${escapeHtml(error.message)}</p>`;
    setStatus(`Error: ${error.message}`);
  }
}

async function onPresentationSearchAndReveal() {
  if (!presentationCoords) {
    setStatus("Location is not available yet.");
    return;
  }

  searchHistoryButton.disabled = true;
  presentationCards.innerHTML = "";
  setStatus("Loading archive, matching, and revealing…");

  try {
    const { latitude, longitude } = presentationCoords;
    const result = await runSimilarityPipeline({
      latitude,
      longitude,
      topN: TOP_N_PRESENTATION,
      articleLimit: ARTICLE_LOOKUP_PRESENTATION
    });
    const rows = result.nearestWithArticles;
    if (!rows.length) {
      setStatus("No similar days found.");
      return;
    }
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
  const rainSnow = escapeHtml(formatHistoricalRainSnow(row));
  const nyt = formatPresentationArticleTdInner(row.article);
  const locText = `${escapeHtml(row.city)} · ${formatNumber(row.latitude, 1)}°, ${formatNumber(row.longitude, 1)}°`;
  return `
    <tr>
      <td class="pres-phase1 presentation-reveal-cell">${escapeHtml(row.date)}</td>
      <td class="pres-phase1 presentation-reveal-cell presentation-cell--loc">${locText}</td>
      <td class="pres-phase2 presentation-reveal-cell"><span class="${tempCssClass(row.temp_mean_c)}">${formatNumber(row.temp_mean_c)}°C</span></td>
      <td class="pres-phase2 presentation-reveal-cell">${rainSnow}</td>
      <td class="pres-phase2 presentation-reveal-cell">${formatNumber(row.cloud_cover_mean_pct)}%</td>
      <td class="pres-phase2 presentation-reveal-cell">${formatNumber(row.wind_speed_mean_kmh)} km/h</td>
      <td class="pres-phase2 presentation-reveal-cell presentation-cell--nyt">${nyt}</td>
    </tr>
  `;
}

function formatPresentationArticleTdInner(article) {
  if (!article || article.checked !== true) {
    return '<span class="presentation-nyt-inline presentation-nyt-inline--muted">—</span>';
  }
  if (article.found) {
    const safeTitle = escapeHtml(article.title || "Untitled");
    const url = article.url ? encodeURI(article.url) : "";
    if (url) {
      return `<a class="presentation-nyt-inline presentation-nyt-inline--link" href="${url}" target="_blank" rel="noopener noreferrer">${safeTitle}</a>`;
    }
    return `<span class="presentation-nyt-inline">${safeTitle}</span>`;
  }
  return '<span class="presentation-nyt-inline presentation-nyt-inline--muted">No headline</span>';
}

function formatHistoricalRainSnow(row) {
  const rain = asNumber(row.rain_sum_mm);
  const snow = asNumber(row.snowfall_sum_cm);
  if (isFiniteNumber(snow) && snow >= 0.1) {
    return `Snow: ${formatNumber(row.snowfall_sum_cm)} cm`;
  }
  if (isFiniteNumber(rain) && rain >= 0.1) {
    return `Rain: ${formatNumber(row.rain_sum_mm)} mm`;
  }
  return "No significant rain or snow";
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
      articleLimit: ARTICLE_LOOKUP_CLASSIC
    });

    renderTodayWeather(result.liveDaily, latitude, longitude);
    renderResults(result.nearestWithArticles);
    renderDebug(
      result.engineered,
      result.liveVector,
      result.featureCols,
      latitude,
      longitude
    );
    setStatus(
      `Done. Found ${result.nearestWithArticles.length} similar days and checked NYT for top ${Math.min(ARTICLE_LOOKUP_CLASSIC, result.nearestWithArticles.length)}.`
    );
  } catch (error) {
    todayWeatherCard.textContent = "Unable to load today's weather.";
    setStatus(`Error: ${error.message}`);
  } finally {
    runButton.disabled = false;
  }
}

async function runSimilarityPipeline({ latitude, longitude, topN, articleLimit }) {
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
  const nearest = getNearestRows(liveVector, historyRows, scalerConfig.feature_cols, topN);
  const nearestWithRaw = attachRawHistoryFields(nearest);

  setStatus("Looking up NYT articles for matches...");
  const nearestWithArticles = await attachNytArticles(nearestWithRaw, articleLimit);

  return {
    liveDaily,
    forecastMeta,
    engineered,
    liveVector,
    nearestWithArticles,
    featureCols: scalerConfig.feature_cols,
    latitude,
    longitude
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

  return {
    daily,
    timezone: payload.timezone != null ? String(payload.timezone) : "",
    latitude: payload.latitude != null ? Number(payload.latitude) : lat,
    longitude: payload.longitude != null ? Number(payload.longitude) : lon
  };
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

function getNearestRows(liveVector, historyRows, featureCols, topN) {
  const scored = [];

  for (const row of historyRows) {
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
      <td>${formatArticleCell(row.article)}</td>
    </tr>`
  )).join("");

  resultsBody.innerHTML = html;
}

function formatArticleCell(article) {
  if (!article || article.checked !== true) {
    return "Not checked";
  }
  if (article.found) {
    const safeTitle = escapeHtml(article.title || "Untitled");
    return article.url
      ? `<a href="${encodeURI(article.url)}" target="_blank" rel="noopener noreferrer">${safeTitle}</a>`
      : safeTitle;
  }
  return "No article found for this day";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

async function attachNytArticles(rows, limit) {
  const capped = Math.max(0, Math.min(rows.length, limit));
  if (capped === 0) {
    return rows.map((row) => ({ ...row, article: { checked: false } }));
  }

  const lookups = rows.slice(0, capped).map((row) => fetchNytArticleForRow(row));
  const results = await Promise.all(lookups);

  return rows.map((row, index) => {
    if (index >= capped) {
      return { ...row, article: { checked: false } };
    }
    return { ...row, article: { checked: true, ...results[index] } };
  });
}

async function fetchNytArticleForRow(row) {
  const params = new URLSearchParams({ date: row.date, city: row.city });
  const response = await fetch(`/api/nyt-article?${params.toString()}`);
  if (!response.ok) {
    return { found: false };
  }
  const payload = await response.json();
  if (!payload || payload.found !== true) {
    return { found: false };
  }
  return {
    found: true,
    title: payload.title || "Untitled",
    url: payload.url || ""
  };
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
