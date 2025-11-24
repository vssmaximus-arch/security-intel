import json
import os
import re
import html
from datetime import datetime
from fpdf import FPDF

DB_PATH = "public/data/news.json"
OUTPUT_DIR = "public"

# --- CONFIGURATION: PROFILES WITH REGION LOCKS ---
REPORT_PROFILES = [
    # EXECUTIVES
    {
        "filename": "briefing_vp_global.pdf",
        "title": "Global VP Security - Daily Executive Brief",
        "scope": "GLOBAL",
        "target_region": "ALL", # VP sees everything
        "min_severity": 2,
        "keywords": []
    },
    {
        "filename": "briefing_dir_apjc.pdf",
        "title": "Director APJC - Regional Overview",
        "scope": "REGION",
        "target_region": "APJC", # Lock to APJC
        "min_severity": 1,
        "keywords": []
    },
    
    # REGIONAL MANAGERS (RSMs) - NOW REGION LOCKED
    {
        "filename": "briefing_rsm_saem.pdf",
        "title": "SAEM & SE Asia (Sivakumaran P.)",
        "scope": "KEYWORD",
        "target_region": "APJC", # Only check APJC news
        "min_severity": 1,
        "keywords": ["bangladesh", "bhutan", "brunei", "cambodia", "laos", "mongolia", "myanmar", "nepal", "thailand", "vietnam", "pakistan", "sri lanka", "maldives", "philippines", "indonesia", "afghanistan", "malaysia", "singapore", "cyberjaya", "penang"]
    },
    {
        "filename": "briefing_rsm_india.pdf",
        "title": "India Lead (Anubhav Mishra)",
        "scope": "KEYWORD",
        "target_region": "APJC", # Lock to APJC
        "min_severity": 1,
        "keywords": ["india", "bangalore", "chennai", "mumbai", "pune", "hyderabad", "gurgaon", "delhi", "kolkata", "ahmedabad"]
    },
    {
        "filename": "briefing_rsm_china.pdf",
        "title": "Greater China (Jason Yang)",
        "scope": "KEYWORD",
        "target_region": "APJC",
        "min_severity": 1,
        "keywords": ["china", "hong kong", "macau", "taiwan", "changsha", "guangzhou", "fuzhou", "hefei", "nanning", "shenzhen", "xiamen", "beijing", "dalian", "hangzhou", "jinan", "nanjing", "qingdao", "shanghai", "shenyang", "zhengzhou", "chengdu", "chongqing", "kunming", "wuhan", "xi'an"]
    },
    {
        "filename": "briefing_rsm_japan_korea.pdf",
        "title": "Japan & Korea (Tomoko K. / Wonjoon M.)",
        "scope": "KEYWORD",
        "target_region": "APJC",
        "min_severity": 1,
        "keywords": ["japan", "tokyo", "osaka", "fukuoka", "kawasaki", "miyazaki", "nagoya", "toyota", "south korea", "seoul", "daejeon", "cheonan"]
    },
    {
        "filename": "briefing_rsm_anz.pdf",
        "title": "ANZ & Oceania (Aleks Krasavcev)",
        "scope": "KEYWORD",
        "target_region": "APJC",
        "min_severity": 1,
        "keywords": ["australia", "new zealand", "christmas island", "fiji", "guam", "kiribati", "palau", "papua new guinea", "samoa", "solomon islands", "tonga", "tuvalu", "sydney", "melbourne", "brisbane", "canberra", "perth", "auckland"]
    }
]

def clean_text(text):
    if not text: return ""
    text = html.unescape(text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'http\S+', '', text)
    
    replacements = {
        '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', 
        '\u2013': '-', '\u2014': '-', '\u2026': '...', 'â€™': "'"
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    return text.encode('latin-1', 'ignore').decode('latin-1').strip()

class PDF(FPDF):
    def header(self):
        self.set_fill_color(0, 118, 206) 
        self.rect(0, 0, 210, 35, 'F')
        self.set_font('Arial', 'B', 16)
        self.set_text_color(255, 255, 255)
        self.cell(0, 15, self.report_title, 0, 1, 'C')
        self.set_font('Arial', '', 10)
        self.cell(0, 10, f'Generated: {datetime.now().strftime("%Y-%m-%d %H:%M UTC")}', 0, 1, 'C')
        self.ln(10)

    def footer(self):
        self.set_y(-15)
        self.set_font('Arial', 'I', 8)
        self.set_text_color(128)
        self.cell(0, 10, f'Internal Security Use Only | Page {self.page_no()}', 0, 0, 'C')

    def chapter_title(self, label):
        self.set_font('Arial', 'B', 12)
        self.set_fill_color(240, 240, 240)
        self.set_text_color(0)
        self.cell(0, 10, f'  {label}', 0, 1, 'L', 1)
        self.ln(4)

    def chapter_body(self, item):
        title = clean_text(item['title'])
        snippet = clean_text(item['snippet'])
        source = clean_text(item['source'])
        
        self.set_font('Arial', 'B', 11)
        self.set_text_color(0)
        self.multi_cell(0, 6, title)
        
        self.set_font('Arial', 'B', 8)
        if item['severity'] == 3:
            self.set_text_color(220, 53, 69)
            sev_label = "CRITICAL"
        elif item['severity'] == 2:
            self.set_text_color(255, 193, 7)
            sev_label = "WARNING"
        else:
            self.set_text_color(13, 110, 253)
            sev_label = "INFO"
            
        meta = f"[{sev_label}] {source} | {item['date_str']}"
        self.cell(0, 6, meta, 0, 1)
        
        self.set_font('Arial', '', 10)
        self.set_text_color(60)
        self.multi_cell(0, 6, snippet)
        
        self.ln(2)
        self.set_font('Arial', 'U', 9)
        self.set_text_color(0, 118, 206)
        self.cell(0, 6, "Read Full Story", 0, 1, 'L', False, item['link'])
        
        self.ln(4)
        self.set_draw_color(220)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(6)

def filter_news(data, profile):
    filtered = []
    for item in data:
        # 1. Severity Filter
        if item['severity'] < profile['min_severity']: continue
        
        # 2. Region Filter (The New Fix)
        # If profile specifies a region, REJECT anything else (unless it's Global)
        if profile.get('target_region') != "ALL":
            if item['region'] != profile['target_region'] and item['region'] != "Global":
                continue

        # 3. Keyword/Scope Filter
        text = (item['title'] + " " + item['snippet']).lower()
        
        if profile['scope'] == "GLOBAL" or profile['scope'] == "REGION":
            filtered.append(item)
        elif profile['scope'] == "KEYWORD":
            if any(k in text for k in profile['keywords']):
                filtered.append(item)
                
    return filtered

def generate_reports():
    if not os.path.exists(DB_PATH): return
    with open(DB_PATH, 'r') as f: full_data = json.load(f)
    full_data.sort(key=lambda x: (x['severity'], x['published']), reverse=True)

    for profile in REPORT_PROFILES:
        items = filter_news(full_data, profile)[:30]
        if not items: continue

        pdf = PDF()
        pdf.report_title = profile['title']
        pdf.add_page()
        pdf.set_auto_page_break(auto=True, margin=15)

        for cat in ["Physical Security", "Cyber", "Logistics", "Weather/Event"]:
            items_in_cat = [x for x in items if x['category'] == cat]
            if items_in_cat:
                pdf.chapter_title(cat.upper())
                for item in items_in_cat: pdf.chapter_body(item)
        
        output_path = os.path.join(OUTPUT_DIR, profile['filename'])
        pdf.output(output_path)

if __name__ == "__main__":
    generate_reports()
