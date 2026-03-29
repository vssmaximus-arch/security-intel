#!/usr/bin/env python3
"""
update_fuel_prices.py — Scrape globalpetrolprices.com via Playwright (headless Chromium).
Country names are JS-rendered so requests-only approach cannot extract them.
Outputs: public/data/fuel_prices.json
Called by: .github/workflows/update_fuel_prices.yml (every 12 hours)
"""
import json, os, sys, re
from datetime import datetime, timezone

URL      = 'https://www.globalpetrolprices.com/gasoline_prices/'
OUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'fuel_prices.json')


def scrape():
    from playwright.sync_api import sync_playwright

    print(f'[fuel-prices] Launching headless Chromium → {URL}')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                       'AppleWebKit/537.36 (KHTML, like Gecko) '
                       'Chrome/122.0.0.0 Safari/537.36',
            locale='en-US',
        )
        page = ctx.new_page()
        page.goto(URL, wait_until='networkidle', timeout=90000)

        # Wait for the bar chart to be visible
        try:
            page.wait_for_selector('.graph_outside_link', timeout=15000)
        except Exception:
            print('[fuel-prices] WARNING: .graph_outside_link selector timeout — proceeding anyway')

        result = page.evaluate('''() => {
            // Country names from bar-chart outside links
            var countryLinks = Array.from(document.querySelectorAll(".graph_outside_link"));
            var countries = countryLinks.map(function(a) {
                return a.textContent.trim().replace(/\\*$/, "").trim();
            }).filter(function(c){ return c.length > 0; });

            // Prices from #graphic numeric text nodes  ">0.024</div>"
            var graphic = document.getElementById("graphic");
            var prices = [];
            if (graphic) {
                var raw = graphic.innerHTML.match(/>([0-9]+\\.[0-9]+)<\\/div>/g) || [];
                prices = raw.map(function(m){
                    return parseFloat(m.replace(">","").replace("</div>",""));
                });
            }

            // Date from H1
            var h1 = document.querySelector("h1");
            var dateText = h1 ? h1.textContent.trim() : "";

            return { countries: countries, prices: prices, dateText: dateText };
        }''')

        browser.close()

    countries = result['countries']
    prices    = result['prices']
    date_text = result['dateText']

    print(f'[fuel-prices] Found {len(countries)} countries, {len(prices)} prices')

    if not countries or not prices:
        raise ValueError(f'Parse failed: {len(countries)} countries, {len(prices)} prices')

    # Extract date string e.g. "23-Mar-2026"
    dm = re.search(r'(\d{1,2}-\w{3}-\d{4})', date_text)
    price_date = dm.group(1) if dm else datetime.now(timezone.utc).strftime('%d-%b-%Y')

    count     = min(len(countries), len(prices))
    price_map = {countries[i]: prices[i] for i in range(count)}

    output = {
        'ok':      True,
        'date':    price_date,
        'isoDate': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'prices':  price_map,
        'count':   count,
        'ts':      int(datetime.now(timezone.utc).timestamp() * 1000),
        'source':  'globalpetrolprices.com',
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False)
    print(f'[fuel-prices] Saved {count} country prices → {OUT_PATH}')
    return output


if __name__ == '__main__':
    try:
        data = scrape()
        print(f'[fuel-prices] Done. Date: {data["date"]}, Countries: {data["count"]}')
    except Exception as e:
        print(f'[fuel-prices] ERROR: {e}', file=sys.stderr)
        sys.exit(1)
