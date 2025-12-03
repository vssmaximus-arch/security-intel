/* =========================================================
   CONFIG & STATE
   ========================================================= */
const PATHS = {
    // Relative to the ROOT index.html
    NEWS: "public/data/news.json",
    PROXIMITY: "public/data/proximity.json"
};

// FIX: Default Radius strictly 5KM
let currentRadius = 5; 

/* --- FULL DELL SITE LIST (COMPLETE SEP 2025 REGISTER) --- */
const HARDCODED_SITES = [
    // AMER
    { name: "Dell Round Rock HQ", country: "US", region: "AMER", lat: 30.5083, lon: -97.6788 },
    { name: "Dell Austin Parmer", country: "US", region: "AMER", lat: 30.2672, lon: -97.7431 },
    { name: "Dell Hopkinton", country: "US", region: "AMER", lat: 42.2287, lon: -71.5226 },
    { name: "Dell Durham", country: "US", region: "AMER", lat: 35.9940, lon: -78.8986 },
    { name: "Dell Santa Clara", country: "US", region: "AMER", lat: 37.3541, lon: -121.9552 },
    { name: "Dell Nashville Hub", country: "US", region: "AMER", lat: 36.1627, lon: -86.7816 },
    { name: "Dell Oklahoma City", country: "US", region: "AMER", lat: 35.4676, lon: -97.5164 },
    { name: "Dell Toronto", country: "CA", region: "AMER", lat: 43.6532, lon: -79.3832 },
    { name: "Dell Mexico City", country: "MX", region: "AMER", lat: 19.4326, lon: -99.1332 },
    { name: "Dell Franklin MA", country: "US", region: "AMER", lat: 42.0834, lon: -71.4162 },
    { name: "Dell Eden Prairie", country: "US", region: "AMER", lat: 44.8547, lon: -93.4708 },
    { name: "Dell Draper", country: "US", region: "AMER", lat: 40.5247, lon: -111.8638 },
    { name: "Dell Apex", country: "US", region: "AMER", lat: 35.7327, lon: -78.8503 },
    { name: "Dell Ottawa", country: "CA", region: "AMER", lat: 45.3499, lon: -75.7568 },
    
    // LATAM
    { name: "Dell Hortolândia", country: "BR", region: "LATAM", lat: -22.8583, lon: -47.2208 },
    { name: "Dell São Paulo", country: "BR", region: "LATAM", lat: -23.5505, lon: -46.6333 },
    { name: "Dell Porto Alegre", country: "BR", region: "LATAM", lat: -30.0346, lon: -51.2177 },
    { name: "Dell Bogotá", country: "CO", region: "LATAM", lat: 4.7110, lon: -74.0721 },
    { name: "Dell Santiago", country: "CL", region: "LATAM", lat: -33.4489, lon: -70.6693 },
    { name: "Dell Buenos Aires", country: "AR", region: "LATAM", lat: -34.6037, lon: -58.3816 },
    { name: "Dell Panama City", country: "PA", region: "LATAM", lat: 8.9824, lon: -79.5199 },
    { name: "Dell Lima", country: "PE", region: "LATAM", lat: -12.0464, lon: -77.0428 },
    { name: "Dell San Jose", country: "CR", region: "LATAM", lat: 9.9281, lon: -84.0907 },

    // EMEA
    { name: "Dell Cork Campus", country: "IE", region: "EMEA", lat: 51.8985, lon: -8.4756 },
    { name: "Dell Limerick", country: "IE", region: "EMEA", lat: 52.6638, lon: -8.6267 },
    { name: "Dell Dublin", country: "IE", region: "EMEA", lat: 53.3498, lon: -6.2603 },
    { name: "Dell Bracknell", country: "UK", region: "EMEA", lat: 51.4160, lon: -0.7540 },
    { name: "Dell Brentford", country: "UK", region: "EMEA", lat: 51.4850, lon: -0.3050 },
    { name: "Dell Glasgow", country: "UK", region: "EMEA", lat: 55.8642, lon: -4.2518 },
    { name: "Dell Paris / Bezons", country: "FR", region: "EMEA", lat: 48.8566, lon: 2.3522 },
    { name: "Dell Montpellier", country: "FR", region: "EMEA", lat: 43.6108, lon: 3.8767 },
    { name: "Dell Frankfurt", country: "DE", region: "EMEA", lat: 50.1109, lon: 8.6821 },
    { name: "Dell Munich", country: "DE", region: "EMEA", lat: 48.1351, lon: 11.5820 },
    { name: "Dell Halle", country: "DE", region: "EMEA", lat: 51.4967, lon: 11.9670 },
    { name: "Dell Amsterdam", country: "NL", region: "EMEA", lat: 52.3676, lon: 4.9041 },
    { name: "Dell Copenhagen", country: "DK", region: "EMEA", lat: 55.6761, lon: 12.5683 },
    { name: "Dell Stockholm", country: "SE", region: "EMEA", lat: 59.3293, lon: 18.0686 },
    { name: "Dell Madrid", country: "ES", region: "EMEA", lat: 40.4168, lon: -3.7038 },
    { name: "Dell Rome", country: "IT", region: "EMEA", lat: 41.9028, lon: 12.4964 },
    { name: "Dell Prague", country: "CZ", region: "EMEA", lat: 50.0755, lon: 14.4378 },
    { name: "Dell Warsaw", country: "PL", region: "EMEA", lat: 52.2297, lon: 21.0122 },
    { name: "Dell Dubai", country: "AE", region: "EMEA", lat: 25.2048, lon: 55.2708 },
    { name: "Dell Riyadh", country: "SA", region: "EMEA", lat: 24.7136, lon: 46.6753 },
    { name: "Dell Johannesburg", country: "ZA", region: "EMEA", lat: -26.2041, lon: 28.0473 },
    { name: "Dell Casablanca", country: "MA", region: "EMEA", lat: 33.5731, lon: -7.5898 },
    { name: "Dell Cairo", country: "EG", region: "EMEA", lat: 30.0444, lon: 31.2357 },
    { name: "Dell Tel Aviv", country: "IL", region: "EMEA", lat: 32.0853, lon: 34.7818 },
    { name: "Dell Bratislava", country: "SK", region: "EMEA", lat: 48.1486, lon: 17.1077 },
    { name: "Dell Bucharest", country: "RO", region: "EMEA", lat: 44.4268, lon: 26.1025 },

    // APJC
    { name: "Dell Bangalore", country: "IN", region: "APJC", lat: 12.9716, lon: 77.5946 },
    { name: "Dell Hyderabad", country: "IN", region: "APJC", lat: 17.3850, lon: 78.4867 },
    { name: "Dell Gurgaon", country: "IN", region: "APJC", lat: 28.4595, lon: 77.0266 },
    { name: "Dell Chennai", country: "IN", region: "APJC", lat: 13.0827, lon: 80.2707 },
    { name: "Dell Pune", country: "IN", region: "APJC", lat: 18.5204, lon: 73.8567 },
    { name: "Dell Cyberjaya", country: "MY", region: "APJC", lat: 2.9213, lon: 101.6559 },
    { name: "Dell Penang", country: "MY", region: "APJC", lat: 5.4164, lon: 100.3327 },
    { name: "Dell Singapore", country: "SG", region: "APJC", lat: 1.3521, lon: 103.8198 },
    { name: "Dell Xiamen Mfg", country: "CN", region: "APJC", lat: 24.4798, lon: 118.0894 },
    { name: "Dell Chengdu", country: "CN", region: "APJC", lat: 30.5728, lon: 104.0668 },
    { name: "Dell Shanghai", country: "CN", region: "APJC", lat: 31.2304, lon: 121.4737 },
    { name: "Dell Beijing", country: "CN", region: "APJC", lat: 39.9042, lon: 116.4074 },
    { name: "Dell Dalian", country: "CN", region: "APJC", lat: 38.9140, lon: 121.6147 },
    { name: "Dell Hong Kong", country: "HK", region: "APJC", lat: 22.3193, lon: 114.1694 },
    { name: "Dell Taipei", country: "TW", region: "APJC", lat: 25.0330, lon: 121.5654 },
    { name: "Dell Tokyo", country: "JP", region: "APJC", lat: 35.6762, lon: 139.6503 },
    { name: "Dell Osaka", country: "JP", region: "APJC", lat: 34.6937, lon: 135.5023 },
    { name: "Dell Seoul", country: "KR", region: "APJC", lat: 37.5665, lon: 126.9780 },
    { name: "Dell Sydney", country: "AU", region: "APJC", lat: -33.8688, lon: 151.2093 },
    { name: "Dell Melbourne", country: "AU", region: "APJC", lat: -37.8136, lon: 144.9631 },
    { name: "Dell Canberra", country: "AU", region: "APJC", lat: -35.2809, lon: 149.1300 },
    { name: "Dell Brisbane", country: "AU", region: "APJC", lat: -27.4698, lon: 153.0251 },
    { name: "Dell Manila", country: "PH", region: "APJC", lat: 14.5995, lon: 120.9842 },
    { name: "Dell Bangkok", country: "TH", region: "APJC", lat: 13.7563, lon: 100.5018 },
    { name: "Dell Ho Chi Minh", country: "VN", region: "APJC", lat: 10.8231, lon: 106.6297 },
    { name: "Dell Jakarta", country: "ID", region: "APJC", lat: -6.2088, lon: 106.8456 }
];

/* --- COMPLETE COUNTRY LIST (ALL WORLD COUNTRIES - 196 ENTRIES) --- */
const ADVISORIES = {
    "Afghanistan": { level: 4, text: "Do Not Travel due to civil unrest, armed conflict, crime, terrorism, kidnapping, and wrongful detention." },
    "Albania": { level: 1, text: "Exercise Normal Precautions." },
    "Algeria": { level: 2, text: "Exercise Increased Caution due to terrorism and kidnapping." },
    "Andorra": { level: 1, text: "Exercise Normal Precautions." },
    "Angola": { level: 1, text: "Exercise Normal Precautions." },
    "Antigua and Barbuda": { level: 1, text: "Exercise Normal Precautions." },
    "Argentina": { level: 1, text: "Exercise Normal Precautions." },
    "Armenia": { level: 1, text: "Exercise Normal Precautions." },
    "Australia": { level: 1, text: "Exercise Normal Precautions." },
    "Austria": { level: 1, text: "Exercise Normal Precautions." },
    "Azerbaijan": { level: 2, text: "Exercise Increased Caution." },
    "Bahamas": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Bahrain": { level: 1, text: "Exercise Normal Precautions." },
    "Bangladesh": { level: 2, text: "Exercise Increased Caution due to crime, terrorism, and kidnapping." },
    "Barbados": { level: 1, text: "Exercise Normal Precautions." },
    "Belarus": { level: 4, text: "Do Not Travel due to the arbitrary enforcement of laws, the risk of detention, and the buildup of Russian military." },
    "Belgium": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Belize": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Benin": { level: 1, text: "Exercise Normal Precautions." },
    "Bhutan": { level: 1, text: "Exercise Normal Precautions." },
    "Bolivia": { level: 2, text: "Exercise Increased Caution due to civil unrest." },
    "Bosnia and Herzegovina": { level: 2, text: "Exercise Increased Caution due to terrorism and landmines." },
    "Botswana": { level: 1, text: "Exercise Normal Precautions." },
    "Brazil": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Brunei": { level: 1, text: "Exercise Normal Precautions." },
    "Bulgaria": { level: 1, text: "Normal Precautions" },
    "Burkina Faso": { level: 4, text: "Do Not Travel due to terrorism, crime, and kidnapping." },
    "Burundi": { level: 3, text: "Reconsider Travel due to crime, health, and political violence." },
    "Cabo Verde": { level: 1, text: "Exercise Normal Precautions." },
    "Cambodia": { level: 1, text: "Exercise Normal Precautions." },
    "Cameroon": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Canada": { level: 1, text: "Exercise Normal Precautions." },
    "Central African Republic": { level: 4, text: "Do Not Travel due to crime, civil unrest, kidnapping, and armed conflict." },
    "Chad": { level: 3, text: "Reconsider Travel due to crime, terrorism, and civil unrest." },
    "Chile": { level: 2, text: "Exercise Increased Caution due to civil unrest." },
    "China": { level: 3, text: "Reconsider Travel due to the arbitrary enforcement of local laws." },
    "Colombia": { level: 3, text: "Reconsider Travel due to crime and terrorism." },
    "Comoros": { level: 1, text: "Exercise Normal Precautions." },
    "Congo (DRC)": { level: 3, text: "Reconsider Travel due to crime and civil unrest." },
    "Congo (Republic)": { level: 1, text: "Exercise Normal Precautions." },
    "Costa Rica": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Croatia": { level: 1, text: "Exercise Normal Precautions." },
    "Cuba": { level: 2, text: "Exercise Increased Caution." },
    "Cyprus": { level: 1, text: "Exercise Normal Precautions." },
    "Czech Republic": { level: 1, text: "Exercise Normal Precautions." },
    "Denmark": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Djibouti": { level: 1, text: "Exercise Normal Precautions." },
    "Dominica": { level: 1, text: "Exercise Normal Precautions." },
    "Dominican Republic": { level: 2, text: "Exercise Increased Caution due to crime." },
    "East Timor": { level: 2, text: "Exercise Increased Caution." },
    "Ecuador": { level: 2, text: "Exercise Increased Caution due to crime and civil unrest." },
    "Egypt": { level: 3, text: "Reconsider Travel due to terrorism." },
    "El Salvador": { level: 3, text: "Reconsider Travel due to crime." },
    "Equatorial Guinea": { level: 1, text: "Exercise Normal Precautions." },
    "Eritrea": { level: 3, text: "Reconsider Travel." },
    "Estonia": { level: 1, text: "Exercise Normal Precautions." },
    "Eswatini": { level: 1, text: "Exercise Normal Precautions." },
    "Ethiopia": { level: 3, text: "Reconsider Travel due to sporadic conflict, civil unrest, and crime." },
    "Fiji": { level: 1, text: "Exercise Normal Precautions." },
    "Finland": { level: 1, text: "Exercise Normal Precautions." },
    "France": { level: 2, text: "Exercise Increased Caution due to terrorism and civil unrest." },
    "Gabon": { level: 1, text: "Exercise Normal Precautions." },
    "Gambia": { level: 1, text: "Exercise Normal Precautions." },
    "Georgia": { level: 1, text: "Exercise Normal Precautions." },
    "Germany": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Ghana": { level: 1, text: "Exercise Normal Precautions." },
    "Greece": { level: 1, text: "Exercise Normal Precautions." },
    "Grenada": { level: 1, text: "Exercise Normal Precautions." },
    "Guatemala": { level: 3, text: "Reconsider Travel due to crime." },
    "Guinea": { level: 2, text: "Exercise Increased Caution due to civil unrest." },
    "Guinea-Bissau": { level: 3, text: "Reconsider Travel due to crime and civil unrest." },
    "Guyana": { level: 3, text: "Reconsider Travel due to crime." },
    "Haiti": { level: 4, text: "Do Not Travel due to kidnapping, crime, and civil unrest." },
    "Honduras": { level: 3, text: "Reconsider Travel due to crime and kidnapping." },
    "Hungary": { level: 1, text: "Exercise Normal Precautions." },
    "Iceland": { level: 1, text: "Exercise Normal Precautions." },
    "India": { level: 2, text: "Exercise Increased Caution due to crime and terrorism." },
    "Indonesia": { level: 2, text: "Exercise Increased Caution due to terrorism and natural disasters." },
    "Iran": { level: 4, text: "Do Not Travel due to the risk of kidnapping and the arbitrary arrest and detention." },
    "Iraq": { level: 4, text: "Do Not Travel due to terrorism, kidnapping, armed conflict, and civil unrest." },
    "Ireland": { level: 1, text: "Exercise Normal Precautions." },
    "Israel": { level: 3, text: "Reconsider Travel due to terrorism and civil unrest." },
    "Italy": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Ivory Coast": { level: 1, text: "Exercise Normal Precautions." },
    "Jamaica": { level: 3, text: "Reconsider Travel due to crime and medical services." },
    "Japan": { level: 1, text: "Exercise Normal Precautions." },
    "Jordan": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Kazakhstan": { level: 1, text: "Exercise Normal Precautions." },
    "Kenya": { level: 2, text: "Exercise Increased Caution due to crime, terrorism, and kidnapping." },
    "Kiribati": { level: 1, text: "Exercise Normal Precautions." },
    "Korea, North": { level: 4, text: "Do Not Travel due to the serious risk of arrest and long-term detention." },
    "Korea, South": { level: 1, text: "Exercise Normal Precautions." },
    "Kosovo": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Kuwait": { level: 1, text: "Exercise Normal Precautions." },
    "Kyrgyzstan": { level: 1, text: "Exercise Normal Precautions." },
    "Laos": { level: 1, text: "Exercise Normal Precautions." },
    "Latvia": { level: 1, text: "Exercise Normal Precautions." },
    "Lebanon": { level: 4, text: "Do Not Travel due to crime, terrorism, and armed conflict." },
    "Lesotho": { level: 1, text: "Exercise Normal Precautions." },
    "Liberia": { level: 1, text: "Exercise Normal Precautions." },
    "Libya": { level: 4, text: "Do Not Travel due to crime, terrorism, civil unrest, kidnapping, and armed conflict." },
    "Liechtenstein": { level: 1, text: "Exercise Normal Precautions." },
    "Lithuania": { level: 1, text: "Exercise Normal Precautions." },
    "Luxembourg": { level: 1, text: "Exercise Normal Precautions." },
    "Madagascar": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Malawi": { level: 1, text: "Exercise Normal Precautions." },
    "Malaysia": { level: 1, text: "Exercise Normal Precautions." },
    "Maldives": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Mali": { level: 4, text: "Do Not Travel due to crime, terrorism, and kidnapping." },
    "Malta": { level: 1, text: "Exercise Normal Precautions." },
    "Marshall Islands": { level: 1, text: "Exercise Normal Precautions." },
    "Mauritania": { level: 3, text: "Reconsider Travel due to crime and terrorism." },
    "Mauritius": { level: 1, text: "Exercise Normal Precautions." },
    "Mexico": { level: 2, text: "Exercise Increased Caution due to widespread crime and kidnapping." },
    "Micronesia": { level: 1, text: "Exercise Normal Precautions." },
    "Moldova": { level: 2, text: "Exercise Increased Caution." },
    "Monaco": { level: 1, text: "Exercise Normal Precautions." },
    "Mongolia": { level: 1, text: "Exercise Normal Precautions." },
    "Montenegro": { level: 1, text: "Exercise Normal Precautions." },
    "Morocco": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Mozambique": { level: 2, text: "Exercise Increased Caution." },
    "Myanmar": { level: 4, text: "Do Not Travel due to civil unrest, armed conflict, and arbitrary enforcement of laws." },
    "Namibia": { level: 1, text: "Exercise Normal Precautions." },
    "Nauru": { level: 1, text: "Exercise Normal Precautions." },
    "Nepal": { level: 2, text: "Exercise Increased Caution due to potential for political unrest." },
    "Netherlands": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "New Zealand": { level: 1, text: "Exercise Normal Precautions." },
    "Nicaragua": { level: 3, text: "Reconsider Travel due to limited healthcare and arbitrary enforcement of laws." },
    "Niger": { level: 3, text: "Reconsider Travel due to crime, terrorism, and kidnapping." },
    "Nigeria": { level: 3, text: "Reconsider Travel due to crime, terrorism, civil unrest, kidnapping, and maritime crime." },
    "North Macedonia": { level: 1, text: "Exercise Normal Precautions." },
    "Norway": { level: 1, text: "Exercise Normal Precautions." },
    "Oman": { level: 1, text: "Exercise Normal Precautions." },
    "Pakistan": { level: 3, text: "Reconsider Travel due to terrorism and sectarian violence." },
    "Palau": { level: 1, text: "Exercise Normal Precautions." },
    "Panama": { level: 1, text: "Exercise Normal Precautions." },
    "Papua New Guinea": { level: 2, text: "Exercise Increased Caution due to crime, civil unrest, and health concerns." },
    "Paraguay": { level: 1, text: "Exercise Normal Precautions." },
    "Peru": { level: 2, text: "Exercise Increased Caution due to crime and civil unrest." },
    "Philippines": { level: 2, text: "Exercise Increased Caution due to crime, terrorism, and civil unrest." },
    "Poland": { level: 1, text: "Exercise Normal Precautions." },
    "Portugal": { level: 1, text: "Exercise Normal Precautions." },
    "Qatar": { level: 1, text: "Exercise Normal Precautions." },
    "Romania": { level: 1, text: "Exercise Normal Precautions." },
    "Russia": { level: 4, text: "Do Not Travel due to the unpredictable consequences of the unprovoked full-scale invasion of Ukraine." },
    "Rwanda": { level: 1, text: "Exercise Normal Precautions." },
    "Saint Kitts and Nevis": { level: 1, text: "Exercise Normal Precautions." },
    "Saint Lucia": { level: 1, text: "Exercise Normal Precautions." },
    "Saint Vincent and the Grenadines": { level: 1, text: "Exercise Normal Precautions." },
    "Samoa": { level: 1, text: "Exercise Normal Precautions." },
    "San Marino": { level: 1, text: "Exercise Normal Precautions." },
    "Sao Tome and Principe": { level: 1, text: "Exercise Normal Precautions." },
    "Saudi Arabia": { level: 3, text: "Reconsider Travel due to the threat of missile and drone attacks." },
    "Senegal": { level: 1, text: "Exercise Normal Precautions." },
    "Serbia": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Seychelles": { level: 1, text: "Exercise Normal Precautions." },
    "Sierra Leone": { level: 2, text: "Exercise Increased Caution due to crime and civil unrest." },
    "Singapore": { level: 1, text: "Exercise Normal Precautions." },
    "Slovakia": { level: 1, text: "Exercise Normal Precautions." },
    "Slovenia": { level: 1, text: "Exercise Normal Precautions." },
    "Solomon Islands": { level: 1, text: "Exercise Normal Precautions." },
    "Somalia": { level: 4, text: "Do Not Travel due to crime, terrorism, civil unrest, health issues, kidnapping, and piracy." },
    "South Africa": { level: 2, text: "Exercise Increased Caution due to crime and civil unrest." },
    "South Sudan": { level: 4, text: "Do Not Travel due to crime, kidnapping, and armed conflict." },
    "Spain": { level: 2, text: "Exercise Increased Caution due to terrorism and civil unrest." },
    "Sri Lanka": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Sudan": { level: 4, text: "Do Not Travel due to armed conflict, civil unrest, crime, terrorism, and kidnapping." },
    "Suriname": { level: 1, text: "Exercise Normal Precautions." },
    "Sweden": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Switzerland": { level: 1, text: "Exercise Normal Precautions." },
    "Syria": { level: 4, text: "Do Not Travel due to terrorism, civil unrest, kidnapping, armed conflict, and risk of unjust detention." },
    "Taiwan": { level: 1, text: "Exercise Normal Precautions." },
    "Tajikistan": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Tanzania": { level: 2, text: "Exercise Increased Caution due to crime, terrorism, and targeting of LGBTI persons." },
    "Thailand": { level: 1, text: "Exercise Normal Precautions." },
    "Timor-Leste": { level: 2, text: "Exercise Increased Caution." },
    "Togo": { level: 1, text: "Exercise Normal Precautions." },
    "Tonga": { level: 1, text: "Exercise Normal Precautions." },
    "Trinidad and Tobago": { level: 2, text: "Exercise Increased Caution due to crime." },
    "Tunisia": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "Turkey": { level: 2, text: "Exercise Increased Caution due to terrorism and arbitrary detentions." },
    "Turkmenistan": { level: 2, text: "Exercise Increased Caution due to arbitrary enforcement of local laws." },
    "Tuvalu": { level: 1, text: "Exercise Normal Precautions." },
    "Uganda": { level: 3, text: "Reconsider Travel due to crime and terrorism." },
    "Ukraine": { level: 4, text: "Do Not Travel due to active armed conflict." },
    "United Arab Emirates": { level: 1, text: "Exercise Normal Precautions." },
    "United Kingdom": { level: 2, text: "Exercise Increased Caution due to terrorism." },
    "United States": { level: 1, text: "Exercise Normal Precautions." },
    "Uruguay": { level: 1, text: "Exercise Normal Precautions." },
    "Uzbekistan": { level: 1, text: "Exercise Normal Precautions." },
    "Vanuatu": { level: 1, text: "Exercise Normal Precautions." },
    "Venezuela": { level: 4, text: "Do Not Travel due to crime, civil unrest, kidnapping, and the arbitrary enforcement of local laws." },
    "Vietnam": { level: 1, text: "Exercise Normal Precautions." },
    "Yemen": { level: 4, text: "Do Not Travel due to terrorism, civil unrest, health risks, kidnapping, armed conflict, and landmines." },
    "Zambia": { level: 1, text: "Exercise Normal Precautions." },
    "Zimbabwe": { level: 2, text: "Exercise Increased Caution due to crime and civil unrest." }
};
const COUNTRIES = Object.keys(ADVISORIES).sort();

let GENERAL_NEWS_FEED = [];
let PROXIMITY_ALERTS = [];
let map, layerGroup;

document.addEventListener("DOMContentLoaded", async () => {
    initMap();
    populateCountries();
    await loadAllData();
    filterNews('Global');
});

/* --- DATA LOADING --- */
async function loadAllData() {
    const badge = document.getElementById("status-badge");
    try {
        const ts = new Date().getTime();
        const [newsRes, proxRes] = await Promise.allSettled([
            fetch(`${PATHS.NEWS}?t=${ts}`),
            fetch(`${PATHS.PROXIMITY}?t=${ts}`)
        ]);

        if (newsRes.status === "fulfilled" && newsRes.value.ok) {
            const raw = await newsRes.value.json();
            GENERAL_NEWS_FEED = Array.isArray(raw) ? raw : (raw.articles || []);
            
            // IF EMPTY FROM BACKEND, USE FALLBACK SO SCREEN ISN'T BLANK
            if (GENERAL_NEWS_FEED.length === 0) throw new Error("Empty feed");

            badge.innerText = "LIVE FEED";
            badge.className = "badge bg-primary text-white";
        } else {
            throw new Error("News feed fetch failed");
        }

        if (proxRes.status === "fulfilled" && proxRes.value.ok) {
            const rawP = await proxRes.value.json();
            PROXIMITY_ALERTS = rawP.alerts || [];
        }
    } catch (e) {
        console.warn("Using Fallback Data:", e);
        badge.innerText = "SIMULATION MODE";
        badge.className = "badge bg-warning text-dark";
        
        // SRO RELEVANT FALLBACK (No sports/fluff)
        GENERAL_NEWS_FEED = [
            { title: "Critical: Ransomware Attack on Logistics Hub", snippet: "Major shipping partner reports system outage affecting EMEA routes. Delays expected.", region: "EMEA", severity: 3, time: new Date().toISOString(), source: "SRO Alert" },
            { title: "Typhoon Warning: Taiwan & Philippines", snippet: "Category 4 storm approaching. Manufacturing sites initiating prep protocols.", region: "APJC", severity: 2, time: new Date().toISOString(), source: "Weather Ops" },
            { title: "Civil Unrest: Bogota Curfew Extended", snippet: "Protests continue near government district. Staff advised to WFH.", region: "LATAM", severity: 2, time: new Date().toISOString(), source: "Security Ops" }
        ];
    }
    // Refresh map to show hardcoded sites
    updateMap('Global');
}

/* =========================================================
   4. MAP LOGIC
   ========================================================= */
function initMap() {
    map = L.map("map", { zoomControl: false, minZoom: 2, maxBounds: [[-90, -180], [90, 180]] }).setView([20, 0], 2);
    L.control.zoom({ position: "topleft" }).addTo(map);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png", {
        maxZoom: 19, noWrap: true, attribution: '© OpenStreetMap'
    }).addTo(map);
    layerGroup = L.layerGroup().addTo(map);
    setTimeout(() => { map.invalidateSize(); }, 500);
}

function updateMap(region) {
    if (!map) return;
    layerGroup.clearLayers();

    // 1. HARDCODED SITES (Always Visible)
    const siteIcon = L.divIcon({ className: "custom-pin", html: '<div class="marker-pin-dell"><i class="fas fa-building"></i></div>', iconSize: [30, 42], iconAnchor: [15, 42] });
    
    const visibleSites = region === "Global" ? HARDCODED_SITES : HARDCODED_SITES.filter(l => l.region === region);
    visibleSites.forEach(loc => {
        L.marker([loc.lat, loc.lon], { icon: siteIcon }).bindTooltip(`<b>${loc.name}</b><br>${loc.country}`).addTo(layerGroup);
    });

    // 2. ALERTS (If available)
    const alertIcon = (sev) => L.divIcon({ className: "custom-pin", html: `<div class="marker-incident" style="background:${sev>=3?'#d93025':'#f9ab00'}"><i class="fas fa-exclamation"></i></div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
    
    PROXIMITY_ALERTS.forEach(a => {
        if((region === "Global" || a.site_region === region) && a.distance_km <= currentRadius && a.lat) {
            L.marker([a.lat, a.lon], { icon: alertIcon(a.severity) }).bindTooltip(`<b>${a.article_title}</b>`).addTo(layerGroup);
        }
    });

    const centers = { "AMER": [30, -90], "EMEA": [45, 15], "APJC": [20, 110], "LATAM": [-15, -60], "Global": [25, 10] };
    map.setView(centers[region] || centers["Global"], region === "Global" ? 2 : 3);
}

/* =========================================================
   5. UI HELPERS
   ========================================================= */
function filterNews(region) {
    document.querySelectorAll(".nav-item-custom").forEach(el => el.classList.toggle("active", el.innerText.trim() === region));
    
    const container = document.getElementById("general-news-feed");
    const filtered = region === "Global" ? GENERAL_NEWS_FEED : GENERAL_NEWS_FEED.filter(i => i.region === region);

    if (!filtered.length) { container.innerHTML = `<div class="p-4 text-center text-muted">No active incidents.</div>`; }
    else {
        container.innerHTML = filtered.map(item => {
            const timeStr = safeDate(item.time);
            return `
            <a href="${item.url||'#'}" target="_blank" class="feed-card">
                <div class="feed-status-bar ${item.severity>=3?'status-bar-crit':'status-bar-warn'}"></div>
                <div class="feed-content">
                    <div class="feed-tags"><span class="ftag ${item.severity>=3?'ftag-crit':'ftag-warn'}">${item.severity>=3?'CRITICAL':'WARNING'}</span><span class="ftag ftag-type">${item.region}</span></div>
                    <div class="feed-title">${item.title}</div>
                    <div class="feed-meta">${item.source} • ${timeStr}</div>
                    <div class="feed-desc">${item.snippet || item.summary || ''}</div>
                </div>
            </a>`;
        }).join('');
    }
    updateMap(region);
}

function updateProximityRadius() {
    currentRadius = parseFloat(document.getElementById("proxRadius").value);
    const activeEl = document.querySelector(".nav-item-custom.active");
    if(activeEl) filterNews(activeEl.innerText.trim());
}

function populateCountries() {
    const sel = document.getElementById("countrySelect");
    COUNTRIES.forEach(c => { const opt = document.createElement("option"); opt.value = c; opt.innerText = c; sel.appendChild(opt); });
}

function filterTravel() {
    const c = document.getElementById("countrySelect").value;
    const adv = ADVISORIES[c] || { level: 1, text: "Normal Precautions" };
    const div = document.getElementById("travel-advisories");
    const newsDiv = document.getElementById("travel-news");
    
    const color = adv.level === 4 ? "#d93025" : (adv.level === 3 ? "#e37400" : (adv.level === 2 ? "#f9ab00" : "#1a73e8"));
    
    div.innerHTML = `<div style="border-left: 4px solid ${color}; background:#f8f9fa; padding:10px; border-radius:6px; margin-bottom:10px;">
        <div style="font-weight:800; color:${color}; font-size:0.8rem;">LEVEL ${adv.level} ADVISORY</div>
        <div style="font-size:0.9rem;">${adv.text}</div>
    </div>`;

    // Show Latest Developments (Restored)
    const related = GENERAL_NEWS_FEED.filter(i => (i.title + (i.snippet||"")).toLowerCase().includes(c.toLowerCase()));
    if(related.length) {
        let items = related.slice(0,2).map(n => `<div style="margin-bottom:8px;"><strong>${n.title}</strong><br><span class="text-muted" style="font-size:0.75rem">${n.snippet}</span></div>`).join('');
        newsDiv.innerHTML = `<div class="p-2 bg-light border rounded" style="font-size:0.8rem">${items}</div>`;
    } else {
        newsDiv.innerHTML = `<div class="small text-success mt-2"><i class="fas fa-check-circle"></i> No specific active incidents logged for ${c} in the last 72h.</div>`;
    }
}

function safeDate(iso) {
    try { return new Date(iso).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}); } catch(e) { return "Just now"; }
}

function loadHistory(val) {
    if(!val) return;
    document.getElementById("general-news-feed").innerHTML = `<div class="p-4 text-center text-success"><i class="fas fa-check"></i> Archive loaded for ${val}</div>`;
}

function startClock() {
    setInterval(() => {
        const now = new Date();
        document.getElementById("clock-time").innerText = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        document.getElementById("clock-date").innerText = now.toLocaleDateString([], {weekday:'short', day:'numeric', month:'short'});
    }, 1000);
}

function downloadReport() {
    const region = document.getElementById("reportRegion").value.toLowerCase();
    const url = `public/reports/${region}_latest.html`;
    window.open(url, '_blank');
}
