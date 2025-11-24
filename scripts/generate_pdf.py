import json
import os
from datetime import datetime
from fpdf import FPDF

DB_PATH = "public/data/news.json"
OUTPUT_DIR = "public"

# --- CONFIGURATION: CUSTOM DELL SECURITY PROFILES ---
REPORT_PROFILES = [
    # 1. EXECUTIVE LEADERSHIP
    {
        "filename": "briefing_vp_global.pdf",
        "title": "Global VP Security - Daily Executive Brief",
        "scope": "GLOBAL",
        "min_severity": 2, # Only Medium & Critical
        "keywords": []
    },
    {
        "filename": "briefing_dir_apjc.pdf",
        "title": "Director APJC - Regional Overview",
        "scope": "REGION",
        "target_region": "APJC",
        "min_severity": 1, # All Severity
        "keywords": []
    },

    # 2. REGIONAL SECURITY MANAGERS (RSMs)
    {
        "filename": "briefing_rsm_saem.pdf",
        "title": "SAEM & SE Asia (Sivakumaran P.)",
        "scope": "KEYWORD",
        "min_severity": 1,
        "keywords": [
            "bangladesh", "bhutan", "brunei", "cambodia", "laos", "mongolia", "myanmar", 
            "nepal", "thailand", "vietnam", "pakistan", "sri lanka", "maldives", 
            "philippines", "indonesia", "afghanistan", "malaysia", "singapore", "cyberjaya", "penang"
        ]
    },
    {
        "filename": "briefing_rsm_india.pdf",
        "title": "India Lead (Anubhav Mishra)",
        "scope": "KEYWORD",
        "min_severity": 1,
        "keywords": [
            "india", "bangalore", "chennai", "mumbai", "pune", "hyderabad", 
            "gurgaon", "delhi", "kolkata", "ahmedabad"
        ]
    },
    {
        "filename": "briefing_rsm_china.pdf",
        "title": "Greater China (Jason Yang)",
        "scope": "KEYWORD",
        "min_severity": 1,
        "keywords": [
            "china", "hong kong", "macau", "taiwan", "changsha", "guangzhou", "fuzhou", 
            "hefei", "nanning", "shenzhen", "xiamen", "beijing", "dalian", "hangzhou", 
            "jinan", "nanjing", "qingdao", "shanghai", "shenyang", "zhengzhou", 
            "chengdu", "chongqing", "kunming", "wuhan", "xi'an"
        ]
    },
    {
        "filename": "briefing_rsm_japan_korea.pdf",
        "title": "Japan & Korea (Tomoko K. / Wonjoon M.)",
        "scope": "KEYWORD",
        "min_severity": 1,
        "keywords": [
            "japan", "tokyo", "osaka", "fukuoka", "kawasaki", "miyazaki", "nagoya", "toyota",
            "south korea", "seoul", "daejeon", "cheonan"
        ]
    },
    {
        "filename": "briefing_rsm_anz.pdf",
        "title": "ANZ & Oceania (Aleks Krasavcev)",
        "scope": "KEYWORD",
        "min_severity": 1,
        "keywords": [
            "australia", "new zealand", "christmas island", "fiji", "guam", "kiribati", 
            "palau", "papua new guinea", "samoa", "solomon islands", "tonga", "tuvalu",
            "sydney", "melbourne", "brisbane", "canberra", "perth", "auckland"
        ]
    }
]

class PDF(FPDF):
    def header(self):
        self.set_fill_color(0, 118, 206) # Dell Blue
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
        # Handle encoding for basic PDF font
        title = item['title'].encode('latin-1', 'replace').decode('latin-1')
        self.set_font('Arial', 'B', 11)
        self.multi_cell(0, 6, title)
        
        self.set_font('Arial', 'I', 9)
        self.set_text_color(100)
        sev_label = "CRITICAL" if item['severity'] == 3 else ("WARNING" if item['severity'] == 2 else "INFO")
        meta = f"[{sev_label}] {item['source']} | {item['date_str']}"
        self.cell(0, 6, meta, 0, 1)
        
        self.set_font('Arial', '', 10)
        self.set_text_color(50)
        snippet = item['snippet'].encode('latin-1', 'replace').decode('latin-1')
        self.multi_cell(0, 6, snippet)
        
        self.ln(5)
        self.set_draw_color(220)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(5)

def filter_news(data, profile):
    filtered = []
    for item in data:
        if item['severity'] < profile['min_severity']: continue
        
        text = (item['title'] + " " + item['snippet']).lower()
        
        if profile['scope'] == "GLOBAL":
            filtered.append(item)
        elif profile['scope'] == "REGION":
            if item['region'] == profile['target_region']:
                filtered.append(item)
        elif profile['scope'] == "KEYWORD":
            if any(k in text for k in profile['keywords']):
                filtered.append(item)
                
    return filtered

def generate_reports():
    if not os.path.exists(DB_PATH):
        print("No data found.")
        return

    with open(DB_PATH, 'r') as f:
        full_data = json.load(f)

    full_data.sort(key=lambda x: (x['severity'], x['published']), reverse=True)

    for profile in REPORT_PROFILES:
        print(f"Generating report: {profile['title']}...")
        
        items = filter_news(full_data, profile)
        items = items[:30]
        
        if not items:
            print(f" - No relevant news for {profile['title']}, skipping PDF.")
            continue

        pdf = PDF()
        pdf.report_title = profile['title']
        pdf.add_page()
        pdf.set_auto_page_break(auto=True, margin=15)

        categories = ["Physical Security", "Cyber", "Logistics", "Weather/Event"]
        
        has_content = False
        for cat in categories:
            items_in_cat = [x for x in items if x['category'] == cat]
            if items_in_cat:
                pdf.chapter_title(cat.upper())
                for item in items_in_cat:
                    pdf.chapter_body(item)
                has_content = True
        
        if has_content:
            output_path = os.path.join(OUTPUT_DIR, profile['filename'])
            pdf.output(output_path)
            print(f" - Created: {output_path}")

if __name__ == "__main__":
    generate_reports()
