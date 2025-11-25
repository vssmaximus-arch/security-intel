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
