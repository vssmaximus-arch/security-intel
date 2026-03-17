/**
 * OSInfoHub Relay Server
 * Runs on Railway — provides egress proxy for sites that block Cloudflare Worker IPs
 * Routes:
 *   GET /health              — health check
 *   GET /relay/thelayoff     — scrapes thelayoff.com/dell and returns structured JSON
 *   GET /relay/rss?url=...   — proxies any RSS feed URL (blocked domain bypass)
 */

const express = require('express');
const fetch   = require('node-fetch');
const app     = express();
const PORT    = process.env.PORT || 3000;

// ── Auth ──────────────────────────────────────────────────────────────────────
const RELAY_SECRET = process.env.RELAY_SECRET || '';

function checkSecret(req, res, next) {
  if (!RELAY_SECRET) return next(); // no secret configured → open (dev mode)
  const provided = req.headers['x-relay-key'] || req.query.key || '';
  if (provided !== RELAY_SECRET) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}

// ── Browser headers ────────────────────────────────────────────────────────────
const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control':   'no-cache',
  'Pragma':          'no-cache',
  'Sec-Fetch-Dest':  'document',
  'Sec-Fetch-Mode':  'navigate',
  'Sec-Fetch-Site':  'none',
  'Sec-Ch-Ua':       '"Google Chrome";v="123", "Not:A-Brand";v="8"',
  'Sec-Ch-Ua-Mobile':'?0',
  'Upgrade-Insecure-Requests': '1',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function htmlDecode(str) {
  return String(str || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function stripTags(str) {
  return String(str || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

/**
 * GET /relay/thelayoff
 * Scrapes thelayoff.com/dell + /t/dell-technologies and returns structured posts
 */
app.get('/relay/thelayoff', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');

  const urls = [
    'https://www.thelayoff.com/dell',
    'https://www.thelayoff.com/t/dell-technologies',
  ];

  const posts = [];
  const seenTitles = new Set();

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`thelayoff fetch ${url} → ${response.status}`);
        continue;
      }

      const html = await response.text();

      // Parse list-group-item post entries
      const itemRe = /<li[^>]*class="[^"]*list-group-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
      let match;
      while ((match = itemRe.exec(html)) !== null) {
        const block = match[1];

        // Extract post link + title
        const linkMatch =
          /<a[^>]+href="(\/[^"#]+)"[^>]*>([^<]{5,200})<\/a>/i.exec(block) ||
          /<a[^>]+href="(\/[^"#]+)"[^>]*>\s*<[^>]+>([^<]{5,200})<\/[^>]+>/i.exec(block);
        if (!linkMatch) continue;

        const postPath  = linkMatch[1];
        const postTitle = htmlDecode(stripTags(linkMatch[2])).replace(/\s+/g, ' ').trim();
        if (postTitle.length < 8) continue;
        if (seenTitles.has(postTitle)) continue;
        seenTitles.add(postTitle);

        // Extract snippet
        const snippetMatch =
          /<(?:p|div|span)[^>]*class="[^"]*(?:snippet|preview|summary|body|content|post-text)[^"]*"[^>]*>([\s\S]{10,400}?)<\/(?:p|div|span)>/i.exec(block) ||
          /<p[^>]*>([\s\S]{15,300}?)<\/p>/i.exec(block);
        const snippet = snippetMatch ? htmlDecode(stripTags(snippetMatch[1])).slice(0, 250) : '';

        // Extract date
        const dateMatch =
          /datetime="([^"]+)"/i.exec(block) ||
          /data-date="([^"]+)"/i.exec(block) ||
          /<time[^>]*>([^<]+)<\/time>/i.exec(block);
        const published_at = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();

        posts.push({
          url:          'https://www.thelayoff.com' + postPath,
          title:        postTitle,
          snippet:      snippet,
          source:       'thelayoff.com',
          source_type:  'forum',
          published_at: published_at,
        });
      }

      if (posts.length > 0) break; // got results from first URL, skip second
    } catch (err) {
      console.error('thelayoff scrape error:', err.message);
    }
  }

  res.json({
    ok:           true,
    count:        posts.length,
    fetched_at:   new Date().toISOString(),
    posts:        posts,
  });
});

/**
 * GET /relay/rss?url=<encoded_feed_url>
 * Proxies any RSS/Atom feed URL — use for feeds that block Cloudflare IPs
 */
app.get('/relay/rss', checkSecret, async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const feedUrl = req.query.url;
  if (!feedUrl) return res.status(400).json({ error: 'Missing ?url= parameter' });

  try {
    // Validate URL
    const parsed = new URL(feedUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Invalid protocol' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const upstream = await fetch(feedUrl, {
      headers: {
        ...BROWSER_HEADERS,
        'Accept': 'application/rss+xml, application/atom+xml, text/xml, */*',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const contentType = upstream.headers.get('content-type') || 'text/xml';
    const body = await upstream.text();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=1800');
    res.status(upstream.status).send(body);
  } catch (err) {
    console.error('RSS relay error:', err.message);
    res.status(502).json({ error: 'Upstream fetch failed', message: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`OSInfoHub relay listening on port ${PORT}`);
});
