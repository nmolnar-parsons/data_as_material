const TOP_N_CLASSIC = 30;
const TOP_N_PRESENTATION = 20;
const SCALER_PATH = "./weather-data/normalized/scaler_params.json";
const NORMALIZED_CSV_PATH = "./weather-data/normalized/combined_weather_normalized.csv";
const RAW_CSV_PATH = "./weather-data/combined/weather_history.csv";
const WORLD_ATLAS_PATH = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const PRESENTATION_ROW_CYCLE_MS = 900;
const PRESENTATION_HEADER_TO_BODY_MS = 400;
const PRESENTATION_SKY_REFRESH_MS = 15 * 60 * 1000;
const WEATHER_MAP_ARC_DURATION_MS = 950;
const WEATHER_MAP_TIMELINE_START_ISO = "2000-01-01";
const WEATHER_MAP_TIMELINE_BOTTOM_OFFSET = 16;
const WEATHER_MAP_TIMELINE_MAP_PADDING = 106;
const PRESENTATION_FORCE_DARK_THEME = true;
const PRESENTATION_DATASET_DAY_COUNT = 9261;
const SEARCH_HISTORY_READY_TEXT = "Search through history";
const SEARCH_HISTORY_LOADING_WEATHER_TEXT = "Loading weather...";
const WEATHER_MAP_FOCUS_GEOMETRY = {
  type: "MultiPoint",
  coordinates: [
    [-168, 71.5],
    [-79.5, 8.5]
  ]
};

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

const SCALER_CONFIG_FALLBACK = {
  feature_cols: [
    "temperature_2m_mean",
    "apparent_temperature_mean",
    "dewpoint_mean_c",
    "rain_sum_log1p",
    "snowfall_sum_log1p",
    "precipitation_hours",
    "sunshine_fraction",
    "cloud_cover_mean_pct",
    "wind_speed_mean_kmh",
    "wind_gusts_max_kmh",
    "weather_code_bucket"
  ],
  weights: {
    temperature_2m_mean: 2.0,
    apparent_temperature_mean: 1.5,
    dewpoint_mean_c: 1.5,
    rain_sum_log1p: 1.5,
    snowfall_sum_log1p: 1.5,
    precipitation_hours: 0.75,
    sunshine_fraction: 1.0,
    cloud_cover_mean_pct: 0.75,
    wind_speed_mean_kmh: 0.75,
    wind_gusts_max_kmh: 1.0,
    weather_code_bucket: 1.0
  },
  center: [15.285332, 13.571041, 8.196834, 0.0, 0.0, 0.0, 0.9235544081827335, 52.791668, 10.679678, 35.28, 1.0],
  scale: [15.862668699999999, 19.794753299999996, 15.09291867, 0.7884573603642702, 1.0, 5.0, 0.27907624472037384, 54.04167, 7.3494649999999995, 16.559995999999998, 2.0],
  wmoBuckets: {
    0: 0,
    1: 1,
    2: 1,
    3: 1,
    45: 2,
    48: 2,
    51: 3,
    53: 3,
    55: 3,
    56: 5,
    57: 5,
    61: 4,
    63: 4,
    65: 4,
    66: 5,
    67: 5,
    71: 6,
    73: 6,
    75: 6,
    77: 6,
    80: 7,
    81: 7,
    82: 7,
    85: 7,
    86: 7,
    95: 8,
    96: 8,
    99: 8
  }
};

let scalerConfigCache = null;
let historyRowsCache = null;
let rawHistoryRowsCache = null;
let rawHistoryIndexCache = null;
let scalerConfigPromise = null;
let historyRowsPromise = null;
let rawHistoryRowsPromise = null;

let presentationCoords = null;
let isPresentationMode = true;
let currentUnit = "F";
let lastForecastMeta = null;
let lastPresentationRows = null;
let presentationSkyIntervalId = null;
let activeArchiveQuery = null;
let presentationMapBoundsRaf = null;
let archivePickerInitStarted = false;
let presentationSearchInProgress = false;
let presentationSimilarVisible = false;

const weatherMapState = {
  loadingPromise: null,
  world: null,
  svg: null,
  root: null,
  layers: null,
  zoom: null,
  currentTransform: null,
  pendingReset: false,
  resizeObserver: null,
  resizeRaf: null,
  currentPoint: null,
  matchPoints: [],
  highlightedPointId: null
};

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
const modeTitleText = document.getElementById("modeTitleText");
const modeSuffix = document.getElementById("modeSuffix");
const presentationPanel = document.getElementById("presentationPanel");
const presentationStory = document.getElementById("presentationStory");
const presentationSimilar = document.getElementById("presentationSimilar");
const classicPanel = document.getElementById("classicPanel");
const presentationNarrative = document.getElementById("presentationNarrative");
const searchHistoryButton = document.getElementById("searchHistoryButton");
const searchHistoryLoader = document.getElementById("searchHistoryLoader");
const presentationCards = document.getElementById("presentationCards");
const weatherMap = document.getElementById("weatherMap");
const unitToggleEl = document.getElementById("unitToggle");

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
const archiveExplorerBar = document.getElementById("archiveExplorerBar");

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

presentationCards.addEventListener("pointerover", onPresentationRowHighlightIn);
presentationCards.addEventListener("pointerout", onPresentationRowHighlightOut);
presentationCards.addEventListener("focusin", onPresentationRowHighlightIn);
presentationCards.addEventListener("focusout", onPresentationRowHighlightOut);

document.addEventListener("DOMContentLoaded", () => {
  setDatasetTitleCount(PRESENTATION_DATASET_DAY_COUNT);
  syncPanels();
  initWeatherMap();
  queuePresentationMapBoundsSync();
  if (isPresentationMode) {
    initPresentationWeather();
  } else {
    setStatus("Ready.");
    scheduleArchivePickerUiInit(false);
  }
});

window.addEventListener("resize", queuePresentationMapBoundsSync);

function syncPanels() {
  document.body.classList.toggle("mode-pres", isPresentationMode);
  document.body.classList.toggle("mode-data", !isPresentationMode);
  presentationPanel.hidden = !isPresentationMode;
  syncPresentationSimilarVisibility();
  const presentationMapPanel = document.getElementById("presentationMapPanel");
  if (presentationMapPanel) {
    presentationMapPanel.hidden = !isPresentationMode;
  }
  classicPanel.hidden = isPresentationMode;
  modeSuffix.textContent = isPresentationMode ? "" : " - data mode";
  modeTitle.setAttribute("aria-pressed", String(isPresentationMode));
  if (isPresentationMode) {
    initWeatherMap();
    queuePresentationMapBoundsSync();
    requestWeatherMapRender();
  }
  if (!isPresentationMode) {
    clearPresentationSkyTheme();
  }
}

function syncPresentationSimilarVisibility() {
  if (presentationSimilar) {
    const shouldShow = isPresentationMode && presentationSimilarVisible;
    if (shouldShow) {
      presentationSimilar.hidden = false;
      window.requestAnimationFrame(() => {
        if (isPresentationMode && presentationSimilarVisible) {
          presentationSimilar.classList.add("is-visible");
        }
      });
    } else {
      presentationSimilar.classList.remove("is-visible");
      presentationSimilar.hidden = true;
    }
  }
}

function setPresentationSimilarVisible(isVisible) {
  presentationSimilarVisible = Boolean(isVisible);
  syncPresentationSimilarVisibility();
}

function setSearchHistoryLoading(isLoading) {
  if (searchHistoryLoader) {
    searchHistoryLoader.hidden = !isLoading;
  }
}

function setSearchHistoryWeatherReady(isReady) {
  searchHistoryButton.disabled = !isReady;
  searchHistoryButton.textContent = isReady
    ? SEARCH_HISTORY_READY_TEXT
    : SEARCH_HISTORY_LOADING_WEATHER_TEXT;
}

function setDatasetTitleCount(count) {
  if (modeTitleText) {
    modeTitleText.textContent = `${count.toLocaleString()} Days of Weather`;
  }
}

function queuePresentationMapBoundsSync() {
  window.cancelAnimationFrame(presentationMapBoundsRaf);
  presentationMapBoundsRaf = window.requestAnimationFrame(syncPresentationMapBounds);
}

function syncPresentationMapBounds() {
  if (!presentationStory) {
    return;
  }
  if (!isPresentationMode) {
    document.documentElement.style.removeProperty("--pres-map-top");
    document.documentElement.style.removeProperty("--pres-map-bottom");
    return;
  }

  const storyRect = presentationStory.getBoundingClientRect();
  const top = Math.max(0, Math.round(storyRect.top));
  const bottom = 32;

  document.documentElement.style.setProperty("--pres-map-top", `${top}px`);
  document.documentElement.style.setProperty("--pres-map-bottom", `${bottom}px`);
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
  refreshWeatherMapFromState();
}

function rerenderPresentationRowsKeepVisibility(rows) {
  presentationCards.innerHTML = rows
    .map((row, index) => buildPresentationTableRowHtml(row, index))
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

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDateOnly(dateIso) {
  const match = String(dateIso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
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

function temperatureColor(celsius) {
  const c = clamp(asNumber(celsius, 12), -20, 40);
  const sixtyFInCelsius = (60 - 32) * 5 / 9;
  return d3.scaleDiverging([-20, sixtyFInCelsius, 40], (t) => d3.interpolateRdYlBu(1 - t))(c);
}

function temperatureRadius(celsius, kind) {
  const t = (clamp(asNumber(celsius, 12), -20, 40) + 20) / 60;
  const radius = 6.2 + t * 10.8;
  return kind === "current" ? radius + 2.4 : radius;
}

function cloudBlur(cloudCover) {
  const cloud = clamp(asNumber(cloudCover, 0), 0, 100);
  return (cloud / 100) * 2.6;
}

function weatherPointFilter(point) {
  const blur = cloudBlur(point.cloudCover);
  const blurPart = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "";
  const shadowPart = point.kind === "current"
    ? "drop-shadow(0 2px 5px rgba(0, 0, 0, 0.3))"
    : "";
  return [blurPart, shadowPart].filter(Boolean).join(" ") || null;
}

function initWeatherMap() {
  if (!weatherMap) {
    return Promise.resolve(null);
  }
  if (weatherMapState.loadingPromise) {
    return weatherMapState.loadingPromise;
  }
  if (
    !window.d3 ||
    !window.topojson ||
    typeof d3.geoModifiedStereographicGs50 !== "function"
  ) {
    weatherMap.innerHTML = '<p class="weather-map-status">Map libraries failed to load.</p>';
    return Promise.resolve(null);
  }

  weatherMap.innerHTML = "";
  const svg = d3.select(weatherMap).append("svg").attr("aria-hidden", "true");
  const root = svg.append("g").attr("class", "weather-map-viewport");
  const layers = {
    base: root.append("g").attr("class", "weather-map-base-layer"),
    land: root.append("g").attr("class", "weather-map-land-layer"),
    boundaries: root.append("g").attr("class", "weather-map-boundary-layer"),
    arcs: root.append("g").attr("class", "weather-map-arc-layer"),
    points: root.append("g").attr("class", "weather-map-point-layer"),
    labels: root.append("g").attr("class", "weather-map-label-layer"),
    timelinePanel: svg.append("g").attr("class", "weather-map-timeline-panel-layer"),
    dateConnectors: svg.append("g").attr("class", "weather-map-date-connector-layer"),
    timeline: svg.append("g").attr("class", "weather-map-timeline-layer")
  };
  layers.base.append("path").attr("class", "weather-map-sphere");
  layers.boundaries.append("path").attr("class", "weather-map-boundary");

  const zoom = d3
    .zoom()
    .scaleExtent([1, 8])
    .on("zoom", (event) => {
      weatherMapState.currentTransform = event.transform;
      root.attr("transform", event.transform);
      updateWeatherMapConnectorPositions(event.transform);
    });
  svg.call(zoom).on("dblclick.zoom", null);

  weatherMapState.svg = svg;
  weatherMapState.root = root;
  weatherMapState.layers = layers;
  weatherMapState.zoom = zoom;
  weatherMapState.currentTransform = d3.zoomIdentity;
  weatherMapState.loadingPromise = d3
    .json(WORLD_ATLAS_PATH)
    .then((worldAtlas) => {
      weatherMapState.world = {
        land: topojson.feature(worldAtlas, worldAtlas.objects.countries).features,
        boundaries: topojson.mesh(
          worldAtlas,
          worldAtlas.objects.countries,
          (a, b) => a !== b
        )
      };
      if (!weatherMapState.resizeObserver && "ResizeObserver" in window) {
        weatherMapState.resizeObserver = new ResizeObserver(() => {
          window.cancelAnimationFrame(weatherMapState.resizeRaf);
          weatherMapState.resizeRaf = window.requestAnimationFrame(() => {
            renderWeatherMap();
          });
        });
        weatherMapState.resizeObserver.observe(weatherMap);
      }
      renderWeatherMap();
      if (weatherMapState.pendingReset) {
        resetWeatherMapView({ transition: false });
      }
      return weatherMapState.world;
    })
    .catch((error) => {
      console.error(error);
      weatherMap.innerHTML = '<p class="weather-map-status">Map failed to load.</p>';
      return null;
    });

  return weatherMapState.loadingPromise;
}

function requestWeatherMapRender(options = {}) {
  const loadPromise = initWeatherMap();
  if (!weatherMapState.world) {
    loadPromise.then(() => renderWeatherMap(options));
    return;
  }
  renderWeatherMap(options);
}

function resetWeatherMapView({ transition = true, duration = 850 } = {}) {
  if (!weatherMapState.svg || !weatherMapState.zoom || !window.d3) {
    weatherMapState.pendingReset = true;
    return;
  }
  weatherMapState.pendingReset = false;
  const identity = d3.zoomIdentity;
  weatherMapState.currentTransform = identity;

  if (transition) {
    weatherMapState.svg
      .transition()
      .duration(duration)
      .ease(d3.easeCubicOut)
      .call(weatherMapState.zoom.transform, identity);
    return;
  }

  weatherMapState.svg.call(weatherMapState.zoom.transform, identity);
}

function makeCurrentMapPoint() {
  if (!lastForecastMeta && !presentationCoords) {
    return null;
  }
  const latitude = asNumber(lastForecastMeta?.latitude, asNumber(presentationCoords?.latitude));
  const longitude = asNumber(lastForecastMeta?.longitude, asNumber(presentationCoords?.longitude));
  const temperatureC = asNumber(lastForecastMeta?.daily?.temperature_2m_mean);
  const cloudCover = asNumber(lastForecastMeta?.daily?.cloud_cover_mean, 0);
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) {
    return null;
  }

  if (activeArchiveQuery) {
    const label = activeArchiveQuery.city || "Archive day";
    return {
      id: "current-archive-query",
      kind: "current",
      latitude,
      longitude,
      temperatureC,
      cloudCover,
      dateIso: activeArchiveQuery.dateIso,
      label,
      detail: `${formatFullDate(activeArchiveQuery.dateIso)} · ${formatTemp(temperatureC)}`,
      tooltipRows: [label, formatFullDate(activeArchiveQuery.dateIso), formatTemp(temperatureC)]
    };
  }

  const place = lastForecastMeta?.timezone || "Current weather";
  const dateIso = lastForecastMeta?.daily?.time || localIsoDate();
  return {
    id: "current-weather",
    kind: "current",
    latitude,
    longitude,
    temperatureC,
    cloudCover,
    dateIso,
    label: "Current weather",
    detail: `${place} · ${formatTemp(temperatureC)}`,
    tooltipRows: ["Current weather", place, formatTemp(temperatureC)]
  };
}

function makeMatchMapPoints(rows) {
  return rows
    .map((row, index) => {
      const latitude = asNumber(row.latitude);
      const longitude = asNumber(row.longitude);
      if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) {
        return null;
      }
      const city = String(row.city || "Unknown place");
      const date = String(row.date || "");
      const temperatureC = asNumber(row.temp_mean_c);
      const cloudCover = asNumber(row.cloud_cover_mean_pct, 0);
      return {
        id: makeMatchMapPointId(row, index),
        kind: "match",
        index,
        latitude,
        longitude,
        temperatureC,
        cloudCover,
        dateIso: date,
        label: city,
        detail: `${formatFullDate(date)} · ${formatTemp(temperatureC)}`,
        tooltipRows: [city, formatFullDate(date), formatTemp(temperatureC)]
      };
    })
    .filter(Boolean);
}

function makeMatchMapPointId(row, index) {
  const latitude = asNumber(row.latitude);
  const longitude = asNumber(row.longitude);
  const city = String(row.city || "Unknown place");
  const date = String(row.date || "");
  return `match-${index}-${city}-${date}-${formatNumber(latitude, 3)}-${formatNumber(longitude, 3)}`;
}

function refreshWeatherMapFromState(options = {}) {
  const { animateArcs = false, clearMatches = false } = options;
  weatherMapState.currentPoint = makeCurrentMapPoint();
  if (clearMatches) {
    weatherMapState.matchPoints = [];
  } else {
    weatherMapState.matchPoints = Array.isArray(lastPresentationRows)
      ? makeMatchMapPoints(lastPresentationRows)
      : [];
  }
  requestWeatherMapRender({ animateArcs });
}

function setWeatherMapMatches(rows, animateArcs = true) {
  weatherMapState.currentPoint = makeCurrentMapPoint();
  weatherMapState.matchPoints = makeMatchMapPoints(rows);
  requestWeatherMapRender({ animateArcs });
}

function projectedMapPoint(point, projection) {
  const projected = projection([point.longitude, point.latitude]);
  if (!projected || !isFiniteNumber(projected[0]) || !isFiniteNumber(projected[1])) {
    return null;
  }
  return { ...point, projected };
}

function projectedArcPathD(fromPoint, toPoint) {
  const [x1, y1] = fromPoint.projected;
  const [x2, y2] = toPoint.projected;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance <= 0) {
    return `M${x1},${y1}L${x2},${y2}`;
  }
  const arcHeight = clamp(distance * 0.32, 28, 150);
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const direction = x2 >= x1 ? -1 : 1;
  const cx = (x1 + x2) / 2 + normalX * arcHeight * direction;
  const cy = (y1 + y2) / 2 + normalY * arcHeight * direction;
  return `M${x1},${y1}Q${cx},${cy} ${x2},${y2}`;
}

function transformedProjectedPoint(projected, transform) {
  const activeTransform = transform || d3.zoomIdentity;
  return typeof activeTransform.apply === "function"
    ? activeTransform.apply(projected)
    : projected;
}

function updateWeatherMapConnectorPositions(transform = weatherMapState.currentTransform || d3.zoomIdentity) {
  if (!weatherMapState.layers?.dateConnectors) {
    return;
  }
  weatherMapState.layers.dateConnectors
    .selectAll("line.weather-map-date-connector")
    .attr("x1", (d) => transformedProjectedPoint(d.projected, transform)[0])
    .attr("y1", (d) => transformedProjectedPoint(d.projected, transform)[1]);
}

function isArcRelatedToPoint(arc, pointId) {
  if (!pointId) {
    return false;
  }
  return pointId === weatherMapState.currentPoint?.id || arc.id === pointId;
}

function applyWeatherMapHighlight() {
  if (!weatherMapState.layers) {
    return;
  }
  const highlightedId = weatherMapState.highlightedPointId;
  const hasHighlight = Boolean(highlightedId);
  weatherMapState.layers.points
    .selectAll("g.weather-map-marker")
    .classed("is-highlighted", (d) => d.id === highlightedId)
    .classed("is-dimmed", (d) => hasHighlight && d.id !== highlightedId);
  weatherMapState.layers.timeline
    .selectAll("circle.weather-map-timeline-date-dot")
    .classed("is-highlighted", (d) => d.id === highlightedId)
    .classed("is-dimmed", (d) => hasHighlight && d.id !== highlightedId);
  weatherMapState.layers.timeline
    .selectAll("g.weather-map-timeline-date-tooltip")
    .classed("is-highlighted", (d) => d.id === highlightedId);
  weatherMapState.layers.arcs
    .selectAll("path.weather-map-arc")
    .classed("is-highlighted", (d) => isArcRelatedToPoint(d, highlightedId))
    .classed("is-dimmed", (d) => hasHighlight && !isArcRelatedToPoint(d, highlightedId));
  weatherMapState.layers.dateConnectors
    .selectAll("line.weather-map-date-connector")
    .classed("is-highlighted", (d) => d.id === highlightedId)
    .classed("is-dimmed", (d) => hasHighlight && d.id !== highlightedId);
}

function setWeatherMapHighlight(pointId) {
  weatherMapState.highlightedPointId = pointId || null;
  applyWeatherMapHighlight();
}

function updateSvgTooltipBackgrounds(groups, textSelector, rectSelector) {
  groups.each(function updateTooltipBackground() {
    const group = d3.select(this);
    const textNode = group.select(textSelector).node();
    const rect = group.select(rectSelector);
    if (!textNode || rect.empty()) {
      return;
    }
    if (group.classed("weather-map-marker--tooltip-disabled")) {
      rect.attr("width", 0).attr("height", 0);
      return;
    }
    const box = textNode.getBBox();
    rect
      .attr("x", box.x - 9)
      .attr("y", box.y - 6)
      .attr("width", box.width + 18)
      .attr("height", box.height + 12);
  });
}

function setSvgTooltipLines(textSelection, getLines) {
  textSelection.each(function updateTooltipLines(d) {
    const lines = getLines(d).filter(Boolean);
    d3.select(this)
      .selectAll("tspan")
      .data(lines)
      .join("tspan")
      .attr("x", 0)
      .attr("dy", (_, index) => {
        if (index === 0) {
          return `${-(lines.length - 1) * 0.58}em`;
        }
        return "1.15em";
      })
      .text((line) => line);
  });
}

function timelineTooltipRows(point) {
  return [formatFullDate(point.dateIso)];
}

function mapTooltipRows(point) {
  return point.suppressTooltip ? [] : [point.label, formatTemp(point.temperatureC)];
}

function getPresentationMatchRow(target) {
  return target.closest?.("tr[data-weather-map-point-id]") || null;
}

function onPresentationRowHighlightIn(event) {
  const row = getPresentationMatchRow(event.target);
  if (!row) return;
  row.classList.add("is-highlighted");
  setWeatherMapHighlight(row.dataset.weatherMapPointId);
}

function onPresentationRowHighlightOut(event) {
  const row = getPresentationMatchRow(event.target);
  if (!row || row.contains(event.relatedTarget)) return;
  row.classList.remove("is-highlighted");
  setWeatherMapHighlight(null);
}

function stopWeatherMapTimelineEvent(event) {
  event.stopPropagation();
  if (event.type === "wheel" || event.type === "dblclick") {
    event.preventDefault();
  }
}

function renderWeatherMap(options = {}) {
  if (!weatherMapState.world || !weatherMapState.svg || !weatherMapState.layers || !weatherMap) {
    return;
  }
  const width = Math.max(320, Math.round(weatherMap.clientWidth || 0));
  const height = Math.max(360, Math.round(weatherMap.clientHeight || 0));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const shouldAnimateArcs = Boolean(options.animateArcs && !reducedMotion);
  const timelinePanelHeight = 56;
  const timelinePanelX = 16;
  const timelinePanelWidth = Math.max(0, width - timelinePanelX * 2);
  const timelinePanelY = Math.max(16, height - timelinePanelHeight - WEATHER_MAP_TIMELINE_BOTTOM_OFFSET);
  const timelineY = timelinePanelY + timelinePanelHeight / 2;
  const timelineLabelInset = 16;
  const timelineLabelWidth = 44;
  const timelineStartX = timelinePanelX + timelineLabelInset + timelineLabelWidth;
  const timelineEndX = timelinePanelX + timelinePanelWidth - timelineLabelInset - timelineLabelWidth;
  const timelineLabelStartX = timelinePanelX + timelineLabelInset;
  const timelineLabelEndX = timelinePanelX + timelinePanelWidth - timelineLabelInset;
  const timelineStartDate = parseIsoDateOnly(WEATHER_MAP_TIMELINE_START_ISO) || new Date(2000, 0, 1);
  const timelineEndDate = parseIsoDateOnly(localIsoDate()) || new Date();
  const timelineScale = d3
    .scaleTime()
    .domain([timelineStartDate, timelineEndDate])
    .range([timelineStartX, timelineEndX])
    .clamp(true);
  const projection = d3
    .geoModifiedStereographicGs50()
    .precision(0.1)
    .fitExtent(
      [
        [12, 36],
        [width - 12, height - WEATHER_MAP_TIMELINE_MAP_PADDING]
      ],
      WEATHER_MAP_FOCUS_GEOMETRY
    );
  const path = d3.geoPath(projection);

  weatherMapState.svg
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`);

  if (weatherMapState.zoom) {
    weatherMapState.zoom
      .extent([
        [0, 0],
        [width, height]
      ])
      .translateExtent([
        [-width, -height],
        [width * 2, height * 2]
      ]);
  }
  if (weatherMapState.root) {
    weatherMapState.root.attr("transform", weatherMapState.currentTransform || d3.zoomIdentity);
  }

  weatherMapState.layers.base
    .select(".weather-map-sphere")
    .datum({ type: "Sphere" })
    .attr("d", path);

  weatherMapState.layers.land
    .selectAll("path")
    .data(weatherMapState.world.land)
    .join("path")
    .attr("class", "weather-map-land")
    .attr("d", path);

  weatherMapState.layers.boundaries
    .select(".weather-map-boundary")
    .datum(weatherMapState.world.boundaries)
    .attr("d", path);

  const currentPoint = weatherMapState.currentPoint
    ? projectedMapPoint(weatherMapState.currentPoint, projection)
    : null;
  const matchPoints = weatherMapState.matchPoints
    .map((point) => projectedMapPoint(point, projection))
    .filter(Boolean);
  const suppressCurrentTooltip = presentationSearchInProgress || matchPoints.length > 0;
  const pointData = currentPoint
    ? [{ ...currentPoint, suppressTooltip: suppressCurrentTooltip }, ...matchPoints]
    : matchPoints;
  const timelinePointData = pointData
    .map((point) => {
      const date = parseIsoDateOnly(point.dateIso);
      if (!date) {
        return null;
      }
      return {
        ...point,
        date,
        timelineX: timelineScale(date),
        timelineY
      };
    })
    .filter(Boolean);
  const visiblePointIds = new Set(pointData.map((point) => point.id));
  if (weatherMapState.highlightedPointId && !visiblePointIds.has(weatherMapState.highlightedPointId)) {
    weatherMapState.highlightedPointId = null;
  }
  const arcData = currentPoint
    ? matchPoints.map((point) => ({
        id: point.id,
        index: point.index,
        pathD: projectedArcPathD(currentPoint, point)
      }))
    : [];

  weatherMapState.layers.dateConnectors
    .selectAll("line.weather-map-date-connector")
    .data(timelinePointData, (d) => d.id)
    .join(
      (enter) => enter
        .append("line")
        .attr("class", (d) => `weather-map-date-connector weather-map-date-connector--${d.kind}`)
        .style("opacity", (d) => (shouldAnimateArcs && d.kind !== "current" ? 0 : 1)),
      (update) => update,
      (exit) => exit.remove()
    )
    .attr("class", (d) => `weather-map-date-connector weather-map-date-connector--${d.kind}`)
    .attr("x2", (d) => d.timelineX)
    .attr("y2", (d) => d.timelineY);
  updateWeatherMapConnectorPositions();

  const timelinePanelData = [{
    id: "timeline-panel",
    x: timelinePanelX,
    y: timelinePanelY,
    width: timelinePanelWidth,
    height: timelinePanelHeight
  }];
  weatherMapState.layers.timelinePanel
    .selectAll("rect.weather-map-timeline-panel")
    .data(timelinePanelData, (d) => d.id)
    .join("rect")
    .attr("class", "weather-map-timeline-panel")
    .attr("x", (d) => d.x)
    .attr("y", (d) => d.y)
    .attr("width", (d) => d.width)
    .attr("height", (d) => d.height)
    .attr("rx", 16)
    .attr("ry", 16)
    .on("mousedown.timelineBlock touchstart.timelineBlock pointerdown.timelineBlock wheel.timelineBlock dblclick.timelineBlock", stopWeatherMapTimelineEvent);

  const timelineLineData = [{ id: "timeline", x1: timelineStartX, x2: timelineEndX, y: timelineY }];
  weatherMapState.layers.timeline
    .selectAll("line.weather-map-timeline-line")
    .data(timelineLineData, (d) => d.id)
    .join("line")
    .attr("class", "weather-map-timeline-line")
    .attr("x1", (d) => d.x1)
    .attr("x2", (d) => d.x2)
    .attr("y1", (d) => d.y)
    .attr("y2", (d) => d.y);

  const timelineLabelData = [
    { id: "start", text: "2000", x: timelineLabelStartX, y: timelineY, anchor: "start" },
    { id: "end", text: String(timelineEndDate.getFullYear()), x: timelineLabelEndX, y: timelineY, anchor: "end" }
  ];
  weatherMapState.layers.timeline
    .selectAll("text.weather-map-timeline-label")
    .data(timelineLabelData, (d) => d.id)
    .join("text")
    .attr("class", "weather-map-timeline-label")
    .attr("x", (d) => d.x)
    .attr("y", (d) => d.y)
    .attr("dominant-baseline", "middle")
    .attr("text-anchor", (d) => d.anchor)
    .text((d) => d.text);

  const timelineDots = weatherMapState.layers.timeline
    .selectAll("circle.weather-map-timeline-date-dot")
    .data(timelinePointData, (d) => d.id)
    .join(
      (enter) => enter
        .append("circle")
        .attr("class", (d) => `weather-map-timeline-date-dot weather-map-timeline-date-dot--${d.kind}`)
        .style("opacity", (d) => (shouldAnimateArcs && d.kind !== "current" ? 0 : 1)),
      (update) => update,
      (exit) => exit.remove()
    )
    .attr("class", (d) => `weather-map-timeline-date-dot weather-map-timeline-date-dot--${d.kind}`)
    .attr("tabindex", 0)
    .attr("role", "img")
    .attr("aria-label", (d) => `Timeline date for ${(d.tooltipRows || [d.label, d.detail]).filter(Boolean).join(". ")}`)
    .attr("cx", (d) => d.timelineX)
    .attr("cy", (d) => d.timelineY)
    .attr("r", (d) => (d.kind === "current" ? 6.9 : 3.6))
    .attr("fill", (d) => temperatureColor(d.temperatureC))
    .style("filter", (d) => weatherPointFilter(d))
    .on("mouseenter", (event, d) => setWeatherMapHighlight(d.id))
    .on("mouseleave", () => setWeatherMapHighlight(null))
    .on("focus", (event, d) => setWeatherMapHighlight(d.id))
    .on("blur", () => setWeatherMapHighlight(null))
    .on("mousedown.timelineBlock touchstart.timelineBlock pointerdown.timelineBlock wheel.timelineBlock dblclick.timelineBlock", stopWeatherMapTimelineEvent);

  weatherMapState.layers.timeline
    .selectAll("g.weather-map-timeline-date-tooltip")
    .data(timelinePointData, (d) => d.id)
    .join(
      (enter) => {
        const tooltip = enter.append("g").attr("class", "weather-map-timeline-date-tooltip");
        tooltip.append("rect").attr("class", "weather-map-tooltip-bg").attr("rx", 8).attr("ry", 8);
        tooltip.append("text").attr("class", "weather-map-timeline-date-label");
        return tooltip;
      },
      (update) => update,
      (exit) => exit.remove()
    )
    .attr("class", "weather-map-timeline-date-tooltip")
    .attr("transform", (d) => `translate(${d.timelineX}, ${d.timelineY - 24})`)
    .call((tooltip) => {
      tooltip
        .select("text.weather-map-timeline-date-label")
        .attr("x", 0)
        .attr("y", 0)
        .attr("dominant-baseline", "middle")
        .attr("text-anchor", "middle")
        .call((text) => setSvgTooltipLines(text, timelineTooltipRows));
      updateSvgTooltipBackgrounds(
        tooltip,
        "text.weather-map-timeline-date-label",
        "rect.weather-map-tooltip-bg"
      );
    });

  const arcs = weatherMapState.layers.arcs
    .selectAll("path")
    .data(arcData, (d) => d.id)
    .join(
      (enter) => enter.append("path").attr("class", "weather-map-arc"),
      (update) => update,
      (exit) => exit.remove()
    )
    .attr("d", (d) => d.pathD);

  arcs.interrupt();
  if (shouldAnimateArcs) {
    arcs.each(function animateArc(d) {
      const length = this.getTotalLength();
      d3.select(this)
        .attr("stroke-dasharray", `${length} ${length}`)
        .attr("stroke-dashoffset", length)
        .transition()
        .delay(d.index * PRESENTATION_ROW_CYCLE_MS)
        .duration(WEATHER_MAP_ARC_DURATION_MS)
        .ease(d3.easeCubicOut)
        .attr("stroke-dashoffset", 0);
    });
  } else {
    arcs.attr("stroke-dasharray", null).attr("stroke-dashoffset", null);
  }

  const timelineAnimatedItems = weatherMapState.layers.dateConnectors
    .selectAll("line.weather-map-date-connector");
  timelineAnimatedItems.interrupt();
  timelineDots.interrupt();
  if (shouldAnimateArcs) {
    timelineAnimatedItems
      .style("opacity", (d) => (d.kind === "current" ? 1 : 0))
      .transition()
      .delay((d) => (d.kind === "current" ? 0 : d.index * PRESENTATION_ROW_CYCLE_MS))
      .duration(420)
      .ease(d3.easeCubicOut)
      .style("opacity", 1);
    timelineDots
      .style("opacity", (d) => (d.kind === "current" ? 1 : 0))
      .transition()
      .delay((d) => (d.kind === "current" ? 0 : d.index * PRESENTATION_ROW_CYCLE_MS))
      .duration(320)
      .ease(d3.easeCubicOut)
      .style("opacity", 1);
  } else {
    timelineAnimatedItems.style("opacity", null);
    timelineDots.style("opacity", null);
  }

  const markerEnter = (enter) => {
    const marker = enter
      .append("g")
      .attr("class", (d) => `weather-map-marker weather-map-marker--${d.kind}`)
      .attr("tabindex", 0)
      .attr("role", "img");
    marker.append("circle");
    marker.append("rect").attr("class", "weather-map-tooltip-bg weather-map-label-bg").attr("rx", 8).attr("ry", 8);
    marker.append("text").attr("class", (d) => `weather-map-label weather-map-label--${d.kind}`);
    return marker;
  };
  const markers = weatherMapState.layers.points
    .selectAll("g")
    .data(pointData, (d) => d.id)
    .join(markerEnter, (update) => update, (exit) => exit.remove())
    .attr("class", (d) => {
      const disabledClass = d.suppressTooltip ? " weather-map-marker--tooltip-disabled" : "";
      return `weather-map-marker weather-map-marker--${d.kind}${disabledClass}`;
    })
    .attr("tabindex", (d) => (d.suppressTooltip ? null : 0))
    .attr("transform", (d) => `translate(${d.projected[0]}, ${d.projected[1]})`)
    .attr("aria-label", (d) => {
      if (d.suppressTooltip) {
        return d.label;
      }
      return (d.tooltipRows || [d.label, d.detail]).filter(Boolean).join(". ");
    })
    .on("mouseenter", (event, d) => setWeatherMapHighlight(d.id))
    .on("mouseleave", () => setWeatherMapHighlight(null))
    .on("focus", (event, d) => setWeatherMapHighlight(d.id))
    .on("blur", () => setWeatherMapHighlight(null));

  markers.interrupt();
  if (shouldAnimateArcs) {
    markers
      .attr("opacity", (d) => (d.kind === "current" ? 1 : 0))
      .transition()
      .delay((d) => (d.kind === "current" ? 0 : d.index * PRESENTATION_ROW_CYCLE_MS))
      .duration(320)
      .ease(d3.easeCubicOut)
      .attr("opacity", 1);
  } else {
    markers.attr("opacity", 1);
  }

  markers
    .select("circle")
    .attr("class", (d) => `weather-map-point weather-map-point--${d.kind}`)
    .attr("r", (d) => temperatureRadius(d.temperatureC, d.kind))
    .attr("fill", (d) => temperatureColor(d.temperatureC))
    .style("filter", (d) => weatherPointFilter(d));

  markers
    .select("text")
    .attr("class", (d) => `weather-map-label weather-map-label--${d.kind}`)
    .attr("x", 0)
    .attr("y", (d) => -temperatureRadius(d.temperatureC, d.kind) - 26)
    .attr("dominant-baseline", "middle")
    .attr("text-anchor", "middle")
    .call((text) => setSvgTooltipLines(text, mapTooltipRows));
  updateSvgTooltipBackgrounds(markers, "text.weather-map-label", "rect.weather-map-tooltip-bg");
  applyWeatherMapHighlight();
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

function precipCondition(daily) {
  const rain = Math.max(0, asNumber(daily.rain_sum));
  const snow = Math.max(0, asNumber(daily.snowfall_sum));
  if (snow >= 0.1) {
    return `${formatNumber(daily.snowfall_sum)} cm of snow`;
  }
  if (rain >= 1) {
    return `${formatNumber(daily.rain_sum)} mm of rain`;
  }
  if (rain >= 0.1) {
    return "light rain";
  }
  return "no rain or snow";
}

function precipConditionClass(daily) {
  const rain = Math.max(0, asNumber(daily.rain_sum));
  const snow = Math.max(0, asNumber(daily.snowfall_sum));
  return rain < 0.1 && snow < 0.1
    ? "presentation-precip-condition presentation-precip-condition--dry"
    : "presentation-precip-condition";
}

function cloudCoverInfo(daily) {
  const cloud = asNumber(daily.cloud_cover_mean);
  if (!isFiniteNumber(cloud)) {
    return {
      text: "unknown cloud cover",
      className: "presentation-cloud-condition presentation-cloud-condition--unknown"
    };
  }
  if (cloud <= 20) {
    return {
      text: "mostly clear skies",
      className: "presentation-cloud-condition presentation-cloud-condition--clear"
    };
  }
  if (cloud <= 50) {
    return {
      text: "some cloud cover",
      className: "presentation-cloud-condition presentation-cloud-condition--some"
    };
  }
  if (cloud <= 80) {
    return {
      text: "cloudy skies",
      className: "presentation-cloud-condition presentation-cloud-condition--cloudy"
    };
  }
  return {
    text: "overcast skies",
    className: "presentation-cloud-condition presentation-cloud-condition--overcast"
  };
}

function buildWeatherDataLineHtml(daily, { archive = false } = {}) {
  const tClass = tempCssClass(daily.temperature_2m_mean);
  const tempStr = formatTemp(daily.temperature_2m_mean);
  const tense = archive ? "It was" : "It is";
  const precipConnector = archive ? "there was" : "with";
  const cloud = cloudCoverInfo(daily);
  return `
    <span class="presentation-weather-data">
      ${tense} <span class="${tClass}">${escapeHtml(tempStr)}</span>,
      ${precipConnector} <span class="${precipConditionClass(daily)}">${escapeHtml(precipCondition(daily))}</span>,
      and <span class="${cloud.className}">${escapeHtml(cloud.text)}</span>.
    </span>
  `;
}

function cityNameFromTimezone(timezone) {
  const raw = String(timezone || "").trim();
  if (!raw) {
    return "your city";
  }
  const city = raw.split("/").pop().replaceAll("_", " ").trim();
  return city || raw;
}

function buildPresentationNarrativeHtml(daily, forecastMeta) {
  const city = escapeHtml(cityNameFromTimezone(forecastMeta.timezone));
  const dateLabel = escapeHtml(formatFullDate(daily.time || localIsoDate()));

  return `
    <p class="presentation-lede">
      Today is <strong>${dateLabel}</strong> in <strong>${city}</strong>.
      ${buildWeatherDataLineHtml(daily)}
      <span class="presentation-question">Who else experienced a day like this?</span>
    </p>
  `;
}

function buildPresentationNarrativeHtmlFromArchive(rawRow, dateIso, cityLabel) {
  const daily = dailyLikeFromRawRow(rawRow);
  const place = escapeHtml(String(cityLabel || rawRow.city || ""));

  return `
    <p class="presentation-lede">
      On <strong>${escapeHtml(formatFullDate(dateIso))}</strong> in <strong>${place}</strong>.
      ${buildWeatherDataLineHtml(daily, { archive: true })}
      <span class="presentation-question">Who else experienced a day like this?</span>
    </p>
  `;
}

async function initPresentationWeather() {
  stopPresentationSkyRefresh();
  clearPresentationSkyTheme();
  activeArchiveQuery = null;
  document.body.classList.remove("pres-archive-visible");
  setPresentationSimilarVisible(false);
  setSearchHistoryLoading(false);
  setSearchHistoryWeatherReady(false);
  presentationCards.innerHTML = "";
  lastPresentationRows = null;
  lastForecastMeta = null;
  presentationCoords = null;
  refreshWeatherMapFromState({ clearMatches: true });
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
    setSearchHistoryWeatherReady(true);
    setStatus("Ready. Search through history to find similar days.");
    applyPresentationSkyThemeFromMeta(forecastMeta);
    refreshWeatherMapFromState({ clearMatches: true });
    startPresentationSkyRefresh();
  } catch (error) {
    presentationCoords = null;
    lastForecastMeta = null;
    refreshWeatherMapFromState({ clearMatches: true });
    clearPresentationSkyTheme();
    presentationNarrative.innerHTML = `<p class="presentation-error">${escapeHtml(error.message)}</p>`;
    setStatus(`Error: ${error.message}`);
  } finally {
    scheduleArchivePickerUiInit(true);
  }
}

async function onPresentationSearchAndReveal() {
  if (!presentationCoords && !activeArchiveQuery) {
    setStatus("Location is not available yet.");
    return;
  }

  searchHistoryButton.disabled = true;
  searchHistoryButton.textContent = SEARCH_HISTORY_READY_TEXT;
  setSearchHistoryLoading(true);
  setPresentationSimilarVisible(true);
  presentationCards.innerHTML = "";
  lastPresentationRows = null;
  presentationSearchInProgress = true;
  refreshWeatherMapFromState({ clearMatches: true });
  resetWeatherMapView({ transition: true });
  setStatus("Loading archive, matching, and revealing…");

  try {
    const result = activeArchiveQuery
      ? await runSimilarityFromArchiveRow({
          city: activeArchiveQuery.city,
          dateIso: activeArchiveQuery.dateIso,
          topN: TOP_N_PRESENTATION,
          dedupeByLocation: false,
          setStatusMessages: false
        })
      : await runSimilarityPipeline({
          latitude: presentationCoords.latitude,
          longitude: presentationCoords.longitude,
          topN: TOP_N_PRESENTATION,
          dedupeByLocation: false
        });
    if (!activeArchiveQuery && result.forecastMeta) {
      lastForecastMeta = result.forecastMeta;
      presentationCoords = {
        latitude: result.latitude,
        longitude: result.longitude
      };
      refreshWeatherMapFromState({ clearMatches: true });
    }
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
    document.body.classList.add("pres-archive-visible");
    setStatus(`Done. Showing ${rows.length} similar days.`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    presentationSearchInProgress = false;
    setSearchHistoryLoading(false);
    setSearchHistoryWeatherReady(true);
  }
}

function revealPresentationRows(rows) {
  setPresentationSimilarVisible(true);
  presentationCards.innerHTML = "";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  rows.forEach((row, index) => {
    presentationCards.insertAdjacentHTML("beforeend", buildPresentationTableRowHtml(row, index));
  });
  setWeatherMapMatches(rows, true);

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

function buildPresentationTableRowHtml(row, index) {
  const locText = escapeHtml(row.city);
  const mapPointId = makeMatchMapPointId(row, index);
  return `
    <tr data-weather-map-point-id="${escapeHtml(mapPointId)}" tabindex="0">
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
  refreshWeatherMapFromState({ clearMatches: true });
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

function buildDarkPresentationStoryGradient(endRgb) {
  const storyEnd = lerpRgb(endRgb, { r: 12, g: 22, b: 38 }, 0.72);
  return `linear-gradient(135deg, rgba(13,24,42,0.94) 0%, ${rgbToCss(storyEnd)} 100%)`;
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
    const storyGradient = buildDarkPresentationStoryGradient(dayB);
    return { skyGradient, storyGradient };
  }
  const skyGradient = `linear-gradient(to bottom, ${rgbToCss(nightA)} 0%, ${rgbToCss(nightB)} 100%)`;
  const storyGradient = buildDarkPresentationStoryGradient(nightB);
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
      const storyGradient = buildDarkPresentationStoryGradient(bottomRgb);
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
  const state = PRESENTATION_FORCE_DARK_THEME
    ? { isDay: false, ...fallbackPresentationGradients(false) }
    : computePresentationSkyState(Date.now(), sunriseMs, sunsetMs, offset, lat, lon);

  document.body.style.setProperty("--pres-sky-gradient", state.skyGradient);
  document.body.style.setProperty("--pres-story-gradient", state.storyGradient);
  document.body.classList.toggle("pres-sky--day", state.isDay);
  document.body.classList.toggle("pres-sky--night", !state.isDay);
}

function clearPresentationSkyTheme() {
  stopPresentationSkyRefresh();
  document.body.style.removeProperty("--pres-sky-gradient");
  document.body.style.removeProperty("--pres-story-gradient");
  document.body.classList.remove("pres-sky--day", "pres-sky--night");
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
  if (!scalerConfigPromise) {
    scalerConfigPromise = fetch(SCALER_PATH)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load scaler JSON at ${SCALER_PATH}.`);
        }
        return response.text();
      })
      .then((jsonText) => {
        if (jsonText.trimStart().startsWith("version https://git-lfs.github.com/spec/v1")) {
          return SCALER_CONFIG_FALLBACK;
        }
        return JSON.parse(jsonText);
      })
      .then((config) => {
        scalerConfigCache = config;
        return scalerConfigCache;
      })
      .catch((error) => {
        scalerConfigPromise = null;
        throw error;
      });
  }
  return scalerConfigPromise;
}

async function loadHistoryRows() {
  if (historyRowsCache) {
    return historyRowsCache;
  }
  if (!historyRowsPromise) {
    historyRowsPromise = fetch(NORMALIZED_CSV_PATH)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load normalized CSV at ${NORMALIZED_CSV_PATH}.`);
        }
        return response.text();
      })
      .then((csvText) => {
        historyRowsCache = parseCsv(csvText);
        return historyRowsCache;
      })
      .catch((error) => {
        historyRowsPromise = null;
        throw error;
      });
  }
  return historyRowsPromise;
}

async function loadRawHistoryRows() {
  if (rawHistoryRowsCache && rawHistoryIndexCache) {
    return rawHistoryRowsCache;
  }
  if (!rawHistoryRowsPromise) {
    rawHistoryRowsPromise = fetch(RAW_CSV_PATH)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load raw history CSV at ${RAW_CSV_PATH}.`);
        }
        return response.text();
      })
      .then((csvText) => {
        rawHistoryRowsCache = parseCsv(csvText);
        rawHistoryIndexCache = new Map(rawHistoryRowsCache.map((row) => [makeHistoryKey(row), row]));
        return rawHistoryRowsCache;
      })
      .catch((error) => {
        rawHistoryRowsPromise = null;
        throw error;
      });
  }
  return rawHistoryRowsPromise;
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
    throw new Error("No historical rows were loaded from normalized data.");
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

function scheduleArchivePickerUiInit(waitForIdle = true) {
  if (archivePickerInitStarted || archivePickerReady) {
    return;
  }
  archivePickerInitStarted = true;
  const start = () => {
    initArchivePickerUi();
  };
  if (waitForIdle && "requestIdleCallback" in window) {
    window.requestIdleCallback(start, { timeout: 2500 });
    return;
  }
  window.setTimeout(start, waitForIdle ? 500 : 0);
}

function waitForPresentationSearchIdle() {
  if (!presentationSearchInProgress) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const check = () => {
      if (!presentationSearchInProgress) {
        resolve();
        return;
      }
      window.setTimeout(check, 150);
    };
    check();
  });
}

async function initArchivePickerUi() {
  if (!archivePickCity || !archivePickYear || !archivePickMonth || !archivePickDay || !archivePickRun) {
    return;
  }
  archivePickerSetEnabled(false);
  archivePickRun.textContent = "Loading archive…";
  try {
    await waitForPresentationSearchIdle();
    const rows = await loadHistoryRows();
    await waitForPresentationSearchIdle();
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
    archivePickerInitStarted = false;
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
      presentationSearchInProgress = true;
      setPresentationSimilarVisible(true);
      refreshWeatherMapFromState({ clearMatches: true });
      resetWeatherMapView({ transition: true });
      const result = await runSimilarityFromArchiveRow({
        city,
        dateIso,
        topN: TOP_N_PRESENTATION,
        dedupeByLocation: false,
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
    if (isPresentationMode) {
      presentationSearchInProgress = false;
    }
    archivePickRun.disabled = false;
  }
}
