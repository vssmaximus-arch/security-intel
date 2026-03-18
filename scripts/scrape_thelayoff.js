/**
 * scrape_thelayoff.js
 * Uses playwright-extra + stealth plugin to bypass Cloudflare bot detection.
 * Stealth hides automation fingerprints (webdriver, plugins, canvas, etc.)
 * that Cloudflare checks even on real Chromium browsers.
 *
 * Falls back to Google Search scraping if thelayoff.com still blocks.
 * Google indexes thelayoff.com posts and serves snippets — no CF protection.
 *
 * Usage: node scripts/scrape_thelayoff.js
 * Env:   WORKER_URL, INGEST_SECRET
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const WORKER_URL    = (process.env.WORKER_URL || 'https://osinfohub.vssmaximus.workers.dev').replace(/\/$/, '');
const INGEST_SECRET = process.env.INGEST_SECRET || '';
const MAX_POSTS     = 40;

const TARGET_URLS = [
  'https://www.thelayoff.com/t/dell-technologies',
  'https://www.thelayoff.com/dell',
];

// Google Search fallback — indexes thelayoff.com posts, no Cloudflare protection
const GOOGLE_SEARCH_URLS = [
  'https://www.google.com/search?q=site:thelayoff.com+dell&tbs=qdr:m&num=20',
  'https://www.google.com/search?q=site:thelayoff.com+"Dell+Technologies"&tbs=qdr:m&num=20',
];

async function scrapeThelayoffDirect(page) {
  const posts = [];
  for (const url of TARGET_URLS) {
    console.log(`[direct] → ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

      const title = await page.title();
      const html  = await page.content();
      const isBlocked = /just a moment|checking your browser|verify you are human|cloudflare ray/i.test(title + ' ' + html);
      if (isBlocked) { console.warn(`[direct] still blocked at ${url}`); continue; }

      console.log(`[direct] loaded: "${title}"`);
      const pagePosts = await page.evaluate((max) => {
        var results = [], seen = new Set();
        document.querySelectorAll('.list-group-item').forEach(function(item) {
          if (results.length >= max) return;
          var link = item.querySelector('a[href^="/"]');
          if (!link) return;
          var t = (link.textContent || '').trim();
          if (!t || t.length < 8 || seen.has(t)) return;
          seen.add(t);
          var timeEl = item.querySelector('time');
          var snippetEl = item.querySelector('p, .snippet, .preview, .post-text');
          results.push({
            url:          'https://www.thelayoff.com' + link.getAttribute('href'),
            title:        t,
            snippet:      snippetEl ? (snippetEl.textContent || '').trim().slice(0, 300) : '',
            published_at: timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent.trim()) : new Date().toISOString(),
            source:       'thelayoff.com',
          });
        });
        return results;
      }, MAX_POSTS);

      console.log(`[direct] extracted ${pagePosts.length} posts`);
      posts.push(...pagePosts);
      if (posts.length > 0) break;
    } catch (e) { console.error(`[direct] error: ${e.message}`); }
  }
  return posts;
}

async function scrapeViaGoogle(page) {
  // Google indexes thelayoff.com — get posts via search results without hitting thelayoff directly
  const posts = [];
  const seen  = new Set();
  for (const url of GOOGLE_SEARCH_URLS) {
    console.log(`[google] → ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2000); // let JS render results

      const title = await page.title();
      const hasCaptcha = /unusual traffic|captcha|verify|robot/i.test(title);
      if (hasCaptcha) { console.warn(`[google] CAPTCHA at ${url}`); continue; }

      const results = await page.evaluate(function() {
        var out = [];
        // Google result containers
        var items = document.querySelectorAll('div.g, div[data-hveid]');
        items.forEach(function(item) {
          var linkEl = item.querySelector('a[href*="thelayoff.com"]');
          if (!linkEl) return;
          var href = linkEl.getAttribute('href') || '';
          if (!href.includes('thelayoff.com')) return;
          var titleEl = item.querySelector('h3');
          var snippetEl = item.querySelector('.VwiC3b, .lEBKkf, span[data-ved], div[style*="webkit"]');
          var t = titleEl ? titleEl.textContent.trim() : '';
          if (!t || t.length < 8) return;
          out.push({
            url:          href.startsWith('/url?') ? new URLSearchParams(href.slice(5)).get('q') || href : href,
            title:        t,
            snippet:      snippetEl ? snippetEl.textContent.trim().slice(0, 300) : '',
            published_at: new Date().toISOString(),
            source:       'thelayoff.com',
          });
        });
        return out;
      });

      console.log(`[google] found ${results.length} thelayoff results`);
      for (var r of results) {
        if (!seen.has(r.title)) { seen.add(r.title); posts.push(r); }
      }
      if (posts.length >= 10) break;
    } catch (e) { console.error(`[google] error: ${e.message}`); }
  }
  return posts;
}

async function main() {
  console.log('[scraper] launching stealth Chromium…');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport:   { width: 1366, height: 768 },
    userAgent:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale:     'en-US',
    timezoneId: 'America/New_York',
  });

  let posts = [];

  // Try 1: direct thelayoff.com with stealth
  const page1 = await context.newPage();
  posts = await scrapeThelayoffDirect(page1);
  await page1.close();

  // Try 2: Google Search fallback (indexes thelayoff.com posts)
  if (posts.length === 0) {
    console.log('[scraper] direct blocked — trying Google Search fallback…');
    const page2 = await context.newPage();
    posts = await scrapeViaGoogle(page2);
    await page2.close();
  }

  await browser.close();
  console.log(`[scraper] total posts: ${posts.length}`);

  if (posts.length === 0) {
    console.warn('[scraper] 0 posts — both thelayoff.com and Google blocked. KV serves cached posts.');
    process.exit(0);
  }

  console.log(`[scraper] sending ${posts.length} posts to Worker…`);
  const resp = await fetch(`${WORKER_URL}/api/admin/ingest-layoff`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'secret': INGEST_SECRET },
    body:    JSON.stringify({ posts }),
  });
  const text = await resp.text();
  console.log(`[scraper] Worker: HTTP ${resp.status} — ${text}`);
  if (!resp.ok) { console.error('[scraper] Worker rejected — check INGEST_SECRET'); process.exit(1); }
  console.log('[scraper] done ✓');
  process.exit(0);
}

main().catch(function(err) {
  console.error('[scraper] fatal:', err.message);
  process.exit(1);
});
