import json
import os
from datetime import datetime

# --- CONFIGURATION ---
DB_PATH = "public/data/news.json"
OUTPUT_DIR = "public/reports"

# Defines who gets what report.
# 'region': If set to a specific code (e.g., 'APJC'), it ONLY pulls news from that region.
# 'keywords': If provided, it further filters by searching titles/snippets for these words.
PROFILES = [
    # EXECUTIVE LEADERSHIP
    { 
        "id": "global", 
        "title": "Global VP Security (Critical Risks)", 
        "region": "ALL", 
        "min_severity": 2, 
        "keywords": [] 
    },
    { 
        "id": "apjc", 
        "title": "Director APJC (Regional Overview)", 
        "region": "APJC", 
        "min_severity": 1, 
        "keywords": [] 
    },

    # REGIONAL SECURITY MANAGERS (RSMs)
    { 
        "id": "india", 
        "title": "India Lead (Anubhav Mishra)", 
        "region": "APJC", 
        "min_severity": 1, 
        "keywords": ["india", "bangalore", "delhi", "mumbai", "chennai", "hyderabad", "pune", "gurgaon", "kolkata", "ahmedabad"] 
    },
    { 
        "id": "greater_china", 
        "title": "Greater China (Jason Yang)", 
        "region": "APJC", 
        "min_severity": 1, 
        "keywords": ["china", "hong kong", "taiwan", "beijing", "shanghai", "shenzhen", "guangzhou", "xiamen", "macau", "chengdu", "wuhan"] 
    },
    { 
        "id": "japan", 
        "title": "Japan (Tomoko Koyama)", 
        "region": "APJC", 
        "min_severity": 1, 
        "keywords": ["japan", "tokyo", "osaka", "kyoto", "fukuoka", "kawasaki", "nagoya"] 
    },
    { 
        "id": "korea", 
        "title": "Korea (Wonjoon Moon)", 
        "region": "APJC", 
        "min_severity": 1, 
        "keywords": ["korea", "seoul", "busan", "incheon", "daejeon", "cheonan"] 
    },
    { 
        "id": "oceania", 
        "title": "Oceania (Aleks Krasavcev)", 
        "region": "APJC", 
        "min_severity": 1, 
        "keywords": ["australia", "new zealand", "sydney", "melbourne", "brisbane", "perth", "auckland", "fiji", "canberra", "papua new guinea"] 
    },
    { 
        "id": "sea", 
        "title": "South East Asia (Sivakumaran P.)", 
        "region": "APJC", 
        "min_severity": 1, 
        "keywords": ["singapore", "malaysia", "thailand", "vietnam", "indonesia", "philippines", "bangladesh", "myanmar", "cambodia", "laos", "nepal", "sri lanka", "pakistan"] 
    }
]

def generate_html(profile, items):
    date_str = datetime.now().strftime("%d %b %Y")
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>{profile['title']} - {date_str}</title>
        <style>
            body {{ font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px; color: #333; }}
            .container {{ max-width: 900px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }}
            .header {{ border-bottom: 4px solid #0076CE; padding-bottom: 20px; margin-bottom: 30px; }}
            h1 {{ color: #0076CE; margin: 0; font-size: 28px; letter-spacing: -0.5px; }}
            .meta {{ color: #666; font-size: 14px; margin-top: 8px; font-weight: 500; }}
            .section-title {{ font-size: 18px; font-weight: 700; color: #444; margin-top: 30px; margin-bottom: 15px; border-left: 4px solid #ddd; padding-left: 10px; text-transform: uppercase; }}
            
            .card {{ background: #fff; border: 1px solid #eee; border-radius: 6px; padding: 15px; margin-bottom: 15px; transition: transform 0.2s; }}
            .card:hover {{ border-color: #0076CE; transform: translateY(-1px); }}
            
            .badges {{ margin-bottom: 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }}
            .tag {{ display: inline-block; padding: 4px 8px; border-radius: 4px; color: white; margin-right: 5px; }}
            .critical {{ background-color: #dc3545; }} 
            .warning {{ background-color: #ffc107; color: #000; }} 
            .info {{ background-color: #0d6efd; }}
            
            .title {{ font-size: 18px; font-weight: 700; display: block; margin-bottom: 8px; color: #111; text-decoration: none; }}
            .title:hover {{ color: #0076CE; text-decoration: underline; }}
            
            .source {{ font-size: 12px; color: #888; margin-bottom: 10px; display: block; }}
            .summary {{ font-size: 14px; line-height: 1.6; color: #555; }}
            
            .footer {{ margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; font-size: 12px; color: #999; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>{profile['title']}</h1>
                <div class="meta">Daily Intelligence Briefing | Generated: {date_str}</div>
            </div>
    """
    
    if not items:
        html += """
        <div style="text-align: center; padding: 40px; color: #777;">
            <h3>No Significant Incidents Detected</h3>
            <p>There are no active security alerts matching this profile in the last 24 hours.</p>
        </div>
        """
    else:
        # Group by Category logic
        categories = ["Physical Security", "Logistics", "Cyber", "Weather/Event", "Infrastructure"]
        
        for cat in categories:
            # Filter items for this category
            cat_items = [i for i in items if i['category'] == cat]
            
            if cat_items:
                html += f"<div class='section-title'>{cat}</div>"
                
                for item in cat_items:
                    # Determine Color
                    sev_class = "info"
                    sev_label = "INFO"
                    if item['severity'] == 3:
                        sev_class = "critical"
                        sev_label = "CRITICAL"
                    elif item['severity'] == 2:
                        sev_class = "warning"
                        sev_label = "WARNING"
                    
                    html += f"""
                    <div class="card">
                        <div class="badges">
                            <span class="tag {sev_class}">{sev_label}</span>
                            <span style="color: #999; float: right;">{item['region']}</span>
                        </div>
                        <a href="{item['link']}" target="_blank" class="title">{item['title']}</a>
                        <span class="source">{item['source']} &bull; {item['date_str']}</span>
                        <div class="summary">{item['snippet']}</div>
                    </div>
                    """

    html += """
            <div class="footer">
                CONFIDENTIAL - Internal Use Only<br>
                Generated by Dell Global Security Intelligence Platform
            </div>
        </div>
    </body>
    </html>
    """
    return html

def main():
    # Safety check: If DB doesn't exist, use empty list
    if not os.path.exists(DB_PATH):
        data = []
    else:
        with open(DB_PATH, 'r') as f:
            try:
                data = json.load(f)
            except:
                data = []
    
    # Sort by Severity (High first) then Date
    data.sort(key=lambda x: (x.get('severity', 1), x.get('published', '')), reverse=True)
    
    # Ensure Output Directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Generate each report
    for profile in PROFILES:
        filtered_items = []
        for item in data:
            # 1. Severity Filter
            if item.get('severity', 1) < profile['min_severity']:
                continue
            
            # 2. Region Filter
            # If profile targets a specific region (like APJC), exclude everything else
            # Global events (like massive cyber attacks) are usually tagged 'Global' and are allowed everywhere
            if profile['region'] != "ALL":
                item_region = item.get('region', 'Global')
                if item_region != profile['region'] and item_region != "Global":
                    continue
            
            # 3. Keyword Filter (If keywords exist)
            if profile['keywords']:
                text = (item.get('title', '') + " " + item.get('snippet', '')).lower()
                # If NONE of the keywords match, skip this item
                if not any(k in text for k in profile['keywords']):
                    continue
            
            filtered_items.append(item)
            
        # Write the file
        html_content = generate_html(profile, filtered_items[:30]) # Top 30 items only
        filename = f"{profile['id']}_latest.html"
        filepath = os.path.join(OUTPUT_DIR, filename)
        
        with open(filepath, "w") as f:
            f.write(html_content)
            
    print(f"Successfully generated {len(PROFILES)} HTML reports.")

if __name__ == "__main__":
    main()
