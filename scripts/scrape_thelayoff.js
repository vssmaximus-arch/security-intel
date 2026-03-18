/**
 * scrape_thelayoff.js
 * Runs inside GitHub Actions with Playwright + real Chromium browser.
 * A real browser solves the Cloudflare JS challenge that blocks all HTTP fetch scrapers.
 * Sends extracted Dell posts to the Cloudflare Worker KV via /api/admin/ingest-layoff.
 *
 * Usage: node scripts/scrape_thelayoff.js
 * Env:   WORKER_URL, INGEST_SECRET
 */

const { chromium } = require('playwright');

const WORKER_URL    = (process.env.WORKER_URL || 'https://osinfohub.vssmaximus.workers.dev').replace(/\/$/, '');
const INGEST_SECRET = process.env.INGEST_SECRET || '';
const MAX_POSTS     = 40;

// Target pages — try dell-technologies first, fall back to /dell
const TARGET_URLS = [
  'https://www.thelayoff.com/t/dell-technologies',
  'https://www.thelayoff.com/dell',
];

async function scrapePage(page, url) {
  console.log(`[scraper] → ${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Give the Cloudflare challenge up to 30 s to complete
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    const title = await page.title();
    const html  = await page.content();

    const isBlocked = /just a moment|checking your browser|verify you are human|cloudflare ray/i.test(title + ' ' + html);
    if (isBlocked) {
      console.warn(`[scraper] Cloudflare challenge still active at ${url}`);
      return [];
    }

    console.log(`[scraper] page title: "${title}"`);

    // Extract posts from the rendered DOM
    const posts = await page.evaluate((maxPosts) => {
      var results = [];
      var seen    = new Set();

      // thelayoff.com uses Bootstrap list-group-item for each thread
      var items = Array.from(document.querySelectorAll('.list-group-item'));

      items.forEach(function(item) {
        if (results.length >= maxPosts) return;

        // Thread link + title
        var link = item.querySelector('a[href^="/"]');
        if (!link) return;
        var titleText = (link.textContent || '').trim();
        if (!titleText || titleText.length < 8) return;
        if (seen.has(titleText)) return;
        seen.add(titleText);

        // Published date from <time> element
        var timeEl = item.querySelector('time');
        var published_at = timeEl
          ? (timeEl.getAttribute('datetime') || timeEl.textContent.trim())
          : new Date().toISOString();

        // Best-effort snippet
        var snippetEl = item.querySelector('p, .snippet, .preview, .post-text, .message-text');
        var snippet   = snippetEl ? (snippetEl.textContent || '').trim().slice(0, 300) : '';

        results.push({
          url:          'https://www.thelayoff.com' + link.getAttribute('href'),
          title:        titleText,
          snippet:      snippet,
          published_at: published_at,
          source:       'thelayoff.com',
        });
      });

      return results;
    }, MAX_POSTS);

    console.log(`[scraper] extracted ${posts.length} posts`);
    return posts;

  } catch (err) {
    console.error(`[scraper] error at ${url}: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log('[scraper] launching Chromium…');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport:   { width: 1366, height: 768 },
    userAgent:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale:     'en-US',
    timezoneId: 'America/New_York',
  });

  let posts = [];
  for (const url of TARGET_URLS) {
    const page = await context.newPage();
    posts = await scrapePage(page, url);
    await page.close();
    if (posts.length > 0) break; // got results — no need to try next URL
  }

  await browser.close();
  console.log(`[scraper] total posts: ${posts.length}`);

  if (posts.length === 0) {
    console.warn('[scraper] no posts extracted — site may be blocking GitHub Actions IPs');
    console.warn('[scraper] exiting with code 0 (non-fatal — Worker KV will serve cached posts)');
    process.exit(0);
  }

  // POST posts to Worker KV via the ingest-layoff admin endpoint
  console.log(`[scraper] sending ${posts.length} posts to ${WORKER_URL}/api/admin/ingest-layoff`);
  const resp = await fetch(`${WORKER_URL}/api/admin/ingest-layoff`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'secret': INGEST_SECRET },
    body:    JSON.stringify({ posts }),
  });

  const text = await resp.text();
  console.log(`[scraper] Worker response: HTTP ${resp.status} — ${text}`);

  if (!resp.ok) {
    console.error('[scraper] Worker rejected posts — check INGEST_SECRET secret');
    process.exit(1);
  }

  console.log('[scraper] done ✓');
  process.exit(0);
}

main().catch(function(err) {
  console.error('[scraper] fatal:', err.message);
  process.exit(1);
});
