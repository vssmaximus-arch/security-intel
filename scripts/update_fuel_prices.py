#!/usr/bin/env python3
"""
update_fuel_prices.py — Daily scrape of globalpetrolprices.com
Outputs: public/data/fuel_prices.json
Called by: .github/workflows/update_news.yml (daily)
"""
import requests, re, json, os, sys
from datetime import datetime, timezone

URL      = 'https://www.globalpetrolprices.com/gasoline_prices/'
OUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'fuel_prices.json')

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
}

def scrape():
    print(f'[fuel-prices] Fetching {URL}')
    res = requests.get(URL, headers=HEADERS, timeout=30)
    res.raise_for_status()
    html = res.text
    print(f'[fuel-prices] Got {len(html)} chars')

    # Extract country names from graph_outside_link anchors
    countries = re.findall(r'class="graph_outside_link"[^>]*>([^<*]+)\*?</a>', html)
    countries = [c.strip() for c in countries if c.strip()]
    print(f'[fuel-prices] Found {len(countries)} countries')

    # Extract prices from #graphic bar chart section
    g_start = html.find('id="graphic"')
    g_end   = html.find('id="outsideLinks"')
    if g_start < 0:
        raise ValueError('Could not find #graphic section in HTML')
    graphic_html = html[g_start: g_end if g_end > g_start else g_start + 120000]
    prices = [float(p) for p in re.findall(r'>(\d+\.\d+)</div>', graphic_html)]
    print(f'[fuel-prices] Found {len(prices)} prices')

    if not countries or not prices:
        raise ValueError(f'Parse failed: {len(countries)} countries, {len(prices)} prices')

    # Extract date from H1
    date_match = re.search(r'Gasoline prices,\s*(?:liter|Octane-95),\s*([^<\n"]+)', html)
    price_date = date_match.group(1).strip() if date_match else datetime.now(timezone.utc).strftime('%d-%b-%Y')

    # Zip into price map
    count = min(len(countries), len(prices))
    price_map = {countries[i]: prices[i] for i in range(count)}

    result = {
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
        json.dump(result, f, ensure_ascii=False)
    print(f'[fuel-prices] Saved {count} country prices to {OUT_PATH}')
    return result

if __name__ == '__main__':
    try:
        data = scrape()
        print(f'[fuel-prices] Done. Date: {data["date"]}, Countries: {data["count"]}')
    except Exception as e:
        print(f'[fuel-prices] ERROR: {e}', file=sys.stderr)
        sys.exit(1)
