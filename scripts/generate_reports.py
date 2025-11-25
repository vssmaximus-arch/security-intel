import json
import os
from datetime import datetime

DB_PATH = "public/data/news.json"
OUTPUT_DIR = "public/reports"

PROFILES = [
    { "id": "global", "title": "Global VP Security", "region": "ALL", "min_severity": 2, "keywords": [] },
    { "id": "apjc", "title": "Director APJC", "region": "APJC", "min_severity": 1, "keywords": [] }
]

def generate_html(profile, items):
    date_str = datetime.now().strftime("%d %b %Y")
    html = f"<html><head><title>{profile['title']}</title></head><body><h1>{profile['title']}</h1><hr>"
    for item in items:
        html += f"<h3>{item['title']}</h3><p>{item['snippet']}</p><hr>"
    html += "</body></html>"
    return html

def main():
    if not os.path.exists(DB_PATH): return
    with open(DB_PATH, 'r') as f: data = json.load(f)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for profile in PROFILES:
        filtered = [i for i in data if i.get('severity',1) >= profile['min_severity']]
        with open(os.path.join(OUTPUT_DIR, f"{profile['id']}_latest.html"), "w") as f:
            f.write(generate_html(profile, filtered[:30]))

if __name__ == "__main__":
    main()
