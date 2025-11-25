#!/usr/bin/env python3
"""
Dell Global Security & Resiliency Intelligence – News Agent

- Ingests RSS feeds
- Applies strict SRO keyword pre-filter
- Uses Gemini for final relevance / classification
- Writes public/data/news.json
- Writes public/map.html

Design:
- Still strict enough to cope with future Google News volume
- But NEVER leaves news.json completely empty:
  * If Gemini returns < MIN_EVENTS, we promote some pre-filtered items as low-severity warnings
  * If absolutely nothing, we write a single heartbeat mock event
"""

import os
import json
import hashlib
from datetime import datetime, timezone
from typing import List, Dict, Any

import feedparser
import folium

from google import genai
from google.genai import types as genai_types

# ---------------------------------------------------------------------------
# PATHS
# ---------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
DATA_PATH = os.path.join(PUBLIC_DIR, "data", "news.json")
MAP_PATH = os.path.join(PUBLIC_DIR, "map.html")
LOCATIONS_PATH = os.path.join(BASE_DIR, "config", "locations.json")

# ---------------------------------------------------------------------------
# FEEDS & LIMITS
# ---------------------------------------------------------------------------

# You can safely add Google News RSS later; this agent already has caps
MAX_ITEMS_PER_FEED = 40       # hard cap per RSS source
MAX_TOTAL_ITEMS = 300         # hard cap overall before AI
MIN_EVENTS_AFTER_AI = 10      # if Gemini returns fewer than this, fallback kicks in

FEEDS = [
    # --- Global wires ---
    {"source": "Reuters World", "url": "https://feeds.reuters.com/reuters/worldnews"},
    {"source": "AP World", "url": "https://apnews.com/hub/apf-intlnews?format=atom"},
    {"source": "BBC World", "url": "https://feeds.bbci.co.uk/news/world/rss.xml"},
    {"source": "DW World", "url": "https://rss.dw.com/rdf/rss-en-world"},

    # --- Official alerts / disasters ---
    {"source": "USGS Sig
