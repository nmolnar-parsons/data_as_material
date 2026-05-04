const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const {
  fetchArticleSearchAllPagesForCombo,
  summarizeDoc
} = require("./nytArticleSearch");

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NYT_API_KEY = process.env.NYT_API_KEY;

if (!NYT_API_KEY) {
  console.warn("Warning: NYT_API_KEY is not set. /api/nyt-article will return errors.");
}

app.use(express.static(__dirname));

app.get("/api/nyt-article", async (req, res) => {
  try {
    if (!NYT_API_KEY) {
      res.status(500).json({ error: "NYT_API_KEY is not configured." });
      return;
    }

    const date = String(req.query.date || "").trim();
    const city = String(req.query.city || "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
      return;
    }
    if (!city) {
      res.status(400).json({ error: "City is required." });
      return;
    }

    const { allArticles, totalHits, pagesFetched } =
      await fetchArticleSearchAllPagesForCombo({
        date,
        location: city,
        apiKey: NYT_API_KEY
      });

    if (!allArticles.length) {
      res.json({
        found: false,
        total_hits: totalHits,
        pages_fetched: pagesFetched,
        article_count: 0
      });
      return;
    }

    const top = summarizeDoc(allArticles[0]);
    res.json({
      found: true,
      title: top.title,
      url: top.url,
      pub_date: top.pub_date,
      total_hits: totalHits,
      pages_fetched: pagesFetched,
      article_count: allArticles.length
    });
  } catch (error) {
    const status = error.status && Number.isFinite(error.status) ? error.status : 500;
    res.status(status >= 400 ? status : 500).json({
      error: error.message || "Unexpected server error."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
