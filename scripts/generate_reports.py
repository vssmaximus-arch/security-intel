import json
import os
from datetime import datetime

DB_PATH = "public/data/news.json"
OUTPUT_DIR = "public/reports"

PROFILES = [
    { "id": "global", "title": "Global VP Security", "region": "ALL", "min_severity": 2, "keywords": [] },
    { "id": "apjc", "title": "Director APJC", "region": "APJC", "min_severity": 1, "keywords": [] },
    { "id": "india", "title": "Regional: India", "region": "APJC", "min_severity": 1, "keywords": ["india", "bangalore"] },
    { "id": "greater_china", "title": "Greater China", "region": "APJC", "min_severity": 1, "keywords": ["china", "hong kong", "taiwan"] },
    { "id": "japan", "title": "Japan", "region": "APJC", "min_severity": 1, "keywords": ["japan", "tokyo"] },
    { "id": "korea", "title": "Korea", "region": "APJC", "min_severity": 1, "keywords": ["korea", "seoul"] },
    { "id": "oceania", "title": "Oceania", "region": "APJC", "min_severity": 1, "keywords": ["australia", "new zealand"] },
    { "id": "sea", "title": "South East Asia", "region": "APJC", "min_severity": 1, "keywords": ["singapore", "malaysia", "thailand", "vietnam"] }
]

def generate_html(profile, items):
    date_str = datetime.now().strftime("%d %b %Y")
    html = f"<html><head><title>{profile['title']}</title><style>body{{font-family:sans-serif;padding:20px;}} .card{{border:1px solid #ddd;padding:15px;margin-bottom:15px;border-radius:5px;}} .red{{border-left:5px solid red;}} .orange{{border-left:5px solid orange;}}</style></head><body><h1>{profile['title']}</h1><p>Generated: {date_str}</p><hr>"
    
    if not items: html += "<p>No critical events.</p>"
    
    for item in items:
        color = "red" if item['severity'] == 3 else "orange"
        html += f"<div class='card {color}'><h3><a href='{item['link']}'>{item['title']}</a></h3><p>{item['snippet']}</p><small>{item['source']} | {item.get('date_str','N/A')}</small></div>"
    
    html += "</body></html>"
    return html

def main():
    if not os.path.exists(DB_PATH): 
        data = []
    else:
        with open(DB_PATH, 'r') as f: data = json.load(f)
    
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    for profile in PROFILES:
        filtered = []
        for item in data:
            if item.get('severity', 1) < profile['min_severity']: continue
            if profile['region'] != "ALL":
                item_region = item.get('region', 'Global')
                if item_region != profile['region'] and item_region != "Global": continue
            
            if profile['keywords']:
                text = (item.get('title', '') + item.get('snippet', '')).lower()
                if not any(k in text for k in profile['keywords']): continue
            
            filtered.append(item)
            
        with open(os.path.join(OUTPUT_DIR, f"{profile['id']}_latest.html"), "w") as f:
            f.write(generate_html(profile, filtered[:30]))

if __name__ == "__main__":
    main()
