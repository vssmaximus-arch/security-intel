import json
import os
from datetime import datetime

DB_PATH = "public/data/news.json"
OUTPUT_DIR = "public/reports"

# --- CUSTOM PROFILES ---
PROFILES = [
    { "id": "global", "title": "Global VP Security (Critical)", "region": "ALL", "min_severity": 2, "keywords": [] },
    { "id": "apjc", "title": "Director APJC (All)", "region": "APJC", "min_severity": 1, "keywords": [] },
    { "id": "india", "title": "Regional: India", "region": "APJC", "min_severity": 1, "keywords": ["india", "bangalore", "delhi", "mumbai", "chennai", "hyderabad", "pune"] },
    { "id": "greater_china", "title": "Greater China", "region": "APJC", "min_severity": 1, "keywords": ["china", "hong kong", "taiwan", "beijing", "shanghai", "shenzhen", "guangzhou", "xiamen"] },
    { "id": "japan", "title": "Japan", "region": "APJC", "min_severity": 1, "keywords": ["japan", "tokyo", "osaka", "kyoto"] },
    { "id": "korea", "title": "Korea", "region": "APJC", "min_severity": 1, "keywords": ["korea", "seoul", "busan", "incheon"] },
    { "id": "oceania", "title": "Oceania (ANZ)", "region": "APJC", "min_severity": 1, "keywords": ["australia", "new zealand", "sydney", "melbourne", "brisbane", "perth", "auckland", "fiji"] },
    { "id": "sea", "title": "South East Asia", "region": "APJC", "min_severity": 1, "keywords": ["singapore", "malaysia", "thailand", "vietnam", "indonesia", "philippines"] }
]

def generate_html(profile, items):
    date_str = datetime.now().strftime("%d %b %Y")
    
    html = f"""
    <html>
    <head>
        <title>{profile['title']} - {date_str}</title>
        <style>
            body {{ font-family: 'Segoe UI', sans-serif; background: #f4f4f4; padding: 20px; }}
            .container {{ max-width: 800px; margin: auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }}
            .header {{ border-bottom: 4px solid #0076CE; padding-bottom: 15px; margin-bottom: 20px; }}
            h1 {{ color: #0076CE; margin: 0; font-size: 24px; }}
            .meta {{ color: #666; font-size: 14px; margin-top: 5px; }}
            .item {{ padding: 15px 0; border-bottom: 1px solid #eee; }}
            .tag {{ display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: white; }}
            .critical {{ background: #dc3545; }} .warning {{ background: #ffc107; color: black; }} .info {{ background: #0d6efd; }}
            .title {{ font-size: 16px; font-weight: bold; margin: 8px 0; display: block; text-decoration: none; color: #333; }}
            .summary {{ color: #555; font-size: 14px; line-height: 1.5; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>{profile['title']}</h1>
                <div class="meta">Generated: {date_str} | Dell Global Security Intelligence</div>
            </div>
    """
    
    if not items:
        html += "<p style='text-align:center; color:#777;'>No significant security events detected in this scope for the last 24 hours.</p>"
    else:
        for item in items:
            sev_class = "critical" if item['severity'] == 3 else ("warning" if item['severity'] == 2 else "info")
            sev_label = "CRITICAL" if item['severity'] == 3 else ("WARNING" if item['severity'] == 2 else "INFO")
            
            html += f"""
            <div class="item">
                <div>
                    <span class="tag {sev_class}">{sev_label}</span>
                    <span style="color:#888; font-size:12px; margin-left:10px;">{item['category']} | {item['source']} | {item['date_str']}</span>
                </div>
                <a href="{item['link']}" target="_blank" class="title">{item['title']}</a>
                <div class="summary">{item['snippet']}</div>
            </div>
            """
            
    html += "</div></body></html>"
    return html

def main():
    if not os.path.exists(DB_PATH): return
    with open(DB_PATH, 'r') as f: data = json.load(f)
    
    # Filter only last 24h (Optional, currently shows latest from DB)
    data.sort(key=lambda x: (x['severity'], x['published']), reverse=True)
    
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    for profile in PROFILES:
        # Filter Logic
        filtered = []
        for item in data:
            if item['severity'] < profile['min_severity']: continue
            
            # Region Lock
            if profile['region'] != "ALL":
                if item['region'] != profile['region'] and item['region'] != "Global": continue
            
            # Keyword Scope
            if profile['keywords']:
                text = (item['title'] + item['snippet']).lower()
                if not any(k in text for k in profile['keywords']): continue
            
            filtered.append(item)
            
        # Generate HTML
        html_content = generate_html(profile, filtered[:30])
        filename = f"{profile['id']}_latest.html"
        
        with open(os.path.join(OUTPUT_DIR, filename), "w") as f:
            f.write(html_content)
            
    print("HTML Reports Generated.")

if __name__ == "__main__":
    main()
