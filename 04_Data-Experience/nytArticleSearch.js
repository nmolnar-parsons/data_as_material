/**
 * NYT Article Search query helpers (Article Search API v2).
 * Mirrors the Python pattern: date window, timesTag.location filter, field list, paging.
 */

const NYT_ARTICLE_SEARCH_BASE_URL = "https://api.nytimes.com/svc/search/v2/articlesearch.json";

const DEFAULT_DATE_WINDOW_DAYS = 7;
const DEFAULT_MAX_PAGES = 3;
const DEFAULT_RETURN_FIELDS =
  "headline,pub_date,snippet,web_url,section_name,keywords";

/**
 * @param {string} dateIso - YYYY-MM-DD
 * @param {number} windowDays - days after start (same semantics as Python: end = start + timedelta(days=windowDays))
 * @returns {{ beginDateStr: string, endDateStr: string }} YYYYMMDD
 */
function buildNytDateRange(dateIso, windowDays = DEFAULT_DATE_WINDOW_DAYS) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso).trim())) {
    throw new Error("Invalid date format. Use YYYY-MM-DD.");
  }
  const start = new Date(`${dateIso.trim()}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error("Invalid date.");
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + windowDays);

  return {
    beginDateStr: toNytCompactDate(start),
    endDateStr: toNytCompactDate(end)
  };
}

function toNytCompactDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** Escape double quotes inside LOCATION for safe use inside fq quotes. */
function escapeLocationForTimesTag(location) {
  return String(location).trim().replaceAll('"', "");
}

/**
 * Build query params for one Article Search request (one page).
 * @param {object} opts
 * @param {string} opts.date - YYYY-MM-DD
 * @param {string} opts.location - City name as NYT knows it
 * @param {number} [opts.page=0]
 * @param {string} opts.apiKey
 * @param {number} [opts.dateWindowDays]
 * @param {string} [opts.returnFields]
 */
function buildArticleSearchParams(opts) {
  const {
    date,
    location,
    page = 0,
    apiKey,
    dateWindowDays = DEFAULT_DATE_WINDOW_DAYS,
    returnFields = DEFAULT_RETURN_FIELDS
  } = opts;

  const city = escapeLocationForTimesTag(location);
  if (!city) {
    throw new Error("LOCATION is required.");
  }

  const { beginDateStr, endDateStr } = buildNytDateRange(date, dateWindowDays);

  const params = new URLSearchParams({
    begin_date: beginDateStr,
    end_date: endDateStr,
    fq: `timesTag.location:("${city}")`,
    sort: "relevance",
    fl: returnFields,
    page: String(Math.max(0, Math.floor(Number(page)) || 0)),
    "api-key": apiKey
  });

  return params;
}

/**
 * Full URL for one request (includes api-key in query string — use only server-side).
 */
function buildArticleSearchUrl(opts) {
  const params = buildArticleSearchParams(opts);
  return `${NYT_ARTICLE_SEARCH_BASE_URL}?${params.toString()}`;
}

/**
 * Fetch a single page. Same contract as Python query_nyt(page).
 * @param {object} opts
 * @param {typeof fetch} [opts.fetchFn]
 */
async function fetchArticleSearchPage(opts) {
  const { fetchFn = fetch } = opts;
  const url = buildArticleSearchUrl(opts);
  const response = await fetchFn(url);
  if (!response.ok) {
    const err = new Error(`NYT API request failed (${response.status}).`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

/**
 * Run up to MAX_PAGES requests and concatenate docs (like collecting all_articles in Python).
 * @param {object} opts
 * @param {string} opts.date
 * @param {string} opts.location
 * @param {string} opts.apiKey
 * @param {number} [opts.maxPages]
 * @param {number} [opts.dateWindowDays]
 * @param {typeof fetch} [opts.fetchFn]
 * @returns {Promise<{ allArticles: object[], totalHits: number | null, pagesFetched: number }>}
 */
async function fetchArticleSearchAllPagesForCombo(opts) {
  const {
    date,
    location,
    apiKey,
    maxPages = DEFAULT_MAX_PAGES,
    dateWindowDays = DEFAULT_DATE_WINDOW_DAYS,
    returnFields = DEFAULT_RETURN_FIELDS,
    fetchFn = fetch
  } = opts;

  const allArticles = [];
  let totalHits = null;
  let pagesFetched = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fetchArticleSearchPage({
      date,
      location,
      page,
      apiKey,
      dateWindowDays,
      returnFields,
      fetchFn
    });

    const meta = payload?.response?.meta;
    if (totalHits === null && meta && typeof meta.hits === "number") {
      totalHits = meta.hits;
    }

    const docs = payload?.response?.docs;
    if (!Array.isArray(docs) || docs.length === 0) {
      break;
    }

    allArticles.push(...docs);
    pagesFetched += 1;

    if (docs.length < 10) {
      break;
    }
  }

  return { allArticles, totalHits, pagesFetched };
}

function summarizeDoc(doc) {
  if (!doc) {
    return null;
  }
  return {
    title: doc?.headline?.main || "Untitled",
    url: doc?.web_url || "",
    pub_date: doc?.pub_date || "",
    snippet: doc?.snippet || "",
    section_name: doc?.section_name || ""
  };
}

/**
 * Build full request URLs for each page (0 .. maxPages-1) for one date/location pair.
 * Useful for debugging; do not log in production (contains api-key).
 */
function buildArticleSearchUrlsForCombo(opts) {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const urls = [];
  for (let page = 0; page < maxPages; page += 1) {
    urls.push(buildArticleSearchUrl({ ...opts, page }));
  }
  return urls;
}

/**
 * @param {Array<{ date: string, location: string }>} combos
 * @param {string} apiKey
 * @param {object} [sharedOpts] - optional dateWindowDays, maxPages, returnFields, fetchFn
 */
async function fetchArticleSearchAllPagesForCombos(combos, apiKey, sharedOpts = {}) {
  const { fetchFn, ...rest } = sharedOpts;
  return Promise.all(
    combos.map(({ date, location }) =>
      fetchArticleSearchAllPagesForCombo({
        date,
        location,
        apiKey,
        fetchFn,
        ...rest
      })
    )
  );
}

module.exports = {
  NYT_ARTICLE_SEARCH_BASE_URL,
  DEFAULT_DATE_WINDOW_DAYS,
  DEFAULT_MAX_PAGES,
  DEFAULT_RETURN_FIELDS,
  buildNytDateRange,
  escapeLocationForTimesTag,
  buildArticleSearchParams,
  buildArticleSearchUrl,
  buildArticleSearchUrlsForCombo,
  fetchArticleSearchPage,
  fetchArticleSearchAllPagesForCombo,
  fetchArticleSearchAllPagesForCombos,
  summarizeDoc
};
