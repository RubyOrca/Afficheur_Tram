/**
 * Afficheur Félix Faure - Nantes
 * Real-time transport, weather and market data display.
 */

// --- CONFIGURATION ---
const STOP_CODE = 'FFAU';
const STOP_CODE_C8 = 'AFRA'; // Anatole France (Bus C8)
const LAT = 47.2184;
const LON = -1.5536;
const FFAU_TO_COMM_MIN = 5; // Travel time FFAU → Commerce (Tram 3 Neustrie, ~1 stop)
const FFAU_TO_SILL_MIN = 3; // Travel time FFAU → Sillon de Bretagne (Tram 3 Marcel Paul, ~1 stop)
const FFAU_TO_DLME_MIN = 9;  // Travel time FFAU → Delorme (Bus 26 H. Région, ~3 stops)
const FFAU_TO_JNLI_MIN = 20; // Travel time FFAU → Jonelière (Bus 26, ~8 stops)
const AFRA_TO_SPIN_MIN = 9;  // Travel time AFRA → Saupin (Bus C8, ~3 stops)

// Real estate: pre-computed from DVF open data (data.gouv.fr)
// Source: files.data.gouv.fr/geo-dvf/latest/csv/{year}/departements/44.csv.gz
// Method: Haversine filter r=800m autour de Félix Faure (47.2091, -1.5573)
// Last updated: April 2026 — refresh annually when DVF data updates
const IMMO_HISTORY = {
    //  année : [ ppm2_moyen, nb_transactions ]
    appart: {
        2021: [4990, 551],
        2022: [4874, 572],
        2023: [4588, 440],
        2024: [4282, 417],
        2025: [4243, 460],
    },
    maison: {   // rayon 1500m — données plus fiables (26-53 tx/an)
        2021: [5694, 53],
        2022: [5573, 46],
        2023: [5528, 33],
        2024: [5650, 31],
        2025: [5530, 26],
    },
};

// --- DOM ELEMENTS ---
const clockEl = document.getElementById('clock');
const dateEl = document.getElementById('date');
const neustrieList = document.getElementById('neustrie-list');
const marcelPaulList = document.getElementById('marcel-paul-list');
const busListEl = document.getElementById('bus-list');
const c8ListEl = document.getElementById('c8-list');
const weatherEl = document.getElementById('weather');
const lastUpdateEl = document.getElementById('last-update');
const marketEl = document.getElementById('market-data');
const marketExtraEl = document.getElementById('market-extra');
const immoEl = document.getElementById('immo-data');
const fuelEl = document.getElementById('fuel-data');
const extraBarEl = document.getElementById('extra-bar');
const switchBtn = document.getElementById('switch-btn');
const bannerEl = document.getElementById('banner');

// --- UTILS ---
const updateClock = () => {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    dateEl.textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
};

const formatTime = (timeStr) => {
    if (timeStr === 'proche') return 'Arrive';
    if (!timeStr) return '--';
    return timeStr.replace('mn', '');
};

const parseMinutes = (timeStr) => {
    if (timeStr === 'proche') return 0;
    const n = parseInt(timeStr);
    return isNaN(n) ? null : n;
};

const createTimeItem = (timeStr, label = '', etaOffsetMin = null, etaLabel = '') => {
    const formatted = formatTime(timeStr);
    const div = document.createElement('div');
    div.className = 'time-item';

    // Always render label span (even if empty) to maintain grid alignment
    let html = `<span class="time-label">${label}</span>`;

    if (formatted === 'Arrive') {
        html += `<span class="pulse">Arrive</span>`;
    } else {
        html += `<span class="time-value">${formatted}</span><span class="time-unit">mn</span>`;
    }

    if (etaOffsetMin !== null) {
        const waitMin = parseMinutes(timeStr);
        if (waitMin !== null) {
            const eta = new Date(Date.now() + (waitMin + etaOffsetMin) * 60000);
            const etaStr = eta.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            html += `<span class="stop-eta">${etaLabel} <strong>${etaStr}</strong></span>`;
        }
    }

    div.innerHTML = html;
    return div;
};

const formatVariation = (pct, period = '') => {
    const sign  = pct >= 0 ? '+' : '';
    const cls   = pct >= 0 ? 'positive' : 'negative';
    const arrow = pct >= 0 ? '▲' : '▼';
    const periodStr = period ? ` <span class="var-period">${period}</span>` : '';
    return `<span class="variation ${cls}">${arrow} ${sign}${pct.toFixed(2)}%${periodStr}</span>`;
};

// --- TRANSPORT ---
// Switch mode: false = normal (departures from FFAU/AFRA, ETA at downstream stop)
//              true  = inverted (departures from downstream stop, ETA at FFAU/AFRA)
let switchMode = false;

const nextLabel = i => ['Prochain', 'Suivant'][i] || '';

// Each block = { listEl, sectionId, sectionLabel, line, rows[] }
// Each row   = { stop, match (terminus filter), labelFn, count, etaLabel, etaMin }
const getBlocks = () => switchMode ? BLOCKS_SWITCHED : BLOCKS_NORMAL;

const BLOCKS_NORMAL = [
    {
        listEl: neustrieList, sectionId: 'tram-neustrie', line: '3',
        sectionLabel: 'Tram 3 • <span class="highlight">Félix Faure → Neustrie / Rezé</span>',
        rows: [{
            stop: 'FFAU', match: t => t.includes('neustrie') || t.includes('rezé'),
            labelFn: nextLabel, count: 2, etaLabel: 'Commerce', etaMin: FFAU_TO_COMM_MIN,
        }],
    },
    {
        listEl: marcelPaulList, sectionId: 'tram-marcel-paul', line: '3',
        sectionLabel: 'Tram 3 • <span class="highlight">Félix Faure → Marcel Paul</span>',
        rows: [{
            stop: 'FFAU', match: t => t.includes('marcel paul'),
            labelFn: nextLabel, count: 2, etaLabel: 'Sillon', etaMin: FFAU_TO_SILL_MIN,
        }],
    },
    {
        listEl: busListEl, sectionId: 'bus-26', line: '26',
        sectionLabel: 'Bus 26 • <span class="highlight">Félix Faure → Delorme / Jonelière</span>',
        rows: [
            { stop: 'FFAU', match: t => t.includes('région'),   labelFn: () => 'H. Région', count: 2, etaLabel: 'Delorme',   etaMin: FFAU_TO_DLME_MIN },
            { stop: 'FFAU', match: t => t.includes('jonelière'), labelFn: () => 'Jonelière', count: 1, etaLabel: 'Jonelière', etaMin: FFAU_TO_JNLI_MIN },
        ],
    },
    {
        listEl: c8ListEl, sectionId: 'bus-c8', line: 'C8',
        sectionLabel: 'C8 • <span class="highlight">Anatole France → Saupin</span>',
        rows: [{
            stop: 'AFRA', match: t => t.includes('saupin') || t.includes('gare'),
            labelFn: nextLabel, count: 2, etaLabel: 'Saupin', etaMin: AFRA_TO_SPIN_MIN,
        }],
    },
];

const BLOCKS_SWITCHED = [
    {
        listEl: neustrieList, sectionId: 'tram-neustrie', line: '3',
        sectionLabel: 'Tram 3 • <span class="highlight">Commerce → Félix Faure</span>',
        rows: [{
            stop: 'COMM', match: t => t.includes('marcel paul'),
            labelFn: nextLabel, count: 2, etaLabel: 'F. Faure', etaMin: FFAU_TO_COMM_MIN,
        }],
    },
    {
        listEl: marcelPaulList, sectionId: 'tram-marcel-paul', line: '3',
        sectionLabel: 'Tram 3 • <span class="highlight">Sillon → Félix Faure</span>',
        rows: [{
            stop: 'SILL', match: t => t.includes('neustrie') || t.includes('rezé'),
            labelFn: nextLabel, count: 2, etaLabel: 'F. Faure', etaMin: FFAU_TO_SILL_MIN,
        }],
    },
    {
        listEl: busListEl, sectionId: 'bus-26', line: '26',
        sectionLabel: 'Bus 26 • <span class="highlight">Delorme → Félix Faure</span>',
        rows: [
            { stop: 'DLME', match: t => t.includes('jonelière'), labelFn: () => 'Delorme',   count: 2, etaLabel: 'F. Faure', etaMin: FFAU_TO_DLME_MIN },
            { stop: 'JNLI', match: t => t.includes('région'),   labelFn: () => 'Jonelière', count: 1, etaLabel: 'F. Faure', etaMin: FFAU_TO_JNLI_MIN },
        ],
    },
    {
        listEl: c8ListEl, sectionId: 'bus-c8', line: 'C8',
        sectionLabel: 'C8 • <span class="highlight">Saupin → Anatole France</span>',
        rows: [{
            stop: 'SPIN', match: t => t.includes('marcel paul'),
            labelFn: nextLabel, count: 2, etaLabel: 'A. France', etaMin: AFRA_TO_SPIN_MIN,
        }],
    },
];

const fetchStop = async (stopCode) => {
    const r = await fetch(`https://open.tan.fr/ewp/tempsattente.json/${stopCode}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
};

const fetchAllTransport = async () => {
    const blocks = getBlocks();

    // Collect unique stops & fetch them in parallel
    const stops = [...new Set(blocks.flatMap(b => b.rows.map(r => r.stop)))];
    const results = await Promise.allSettled(stops.map(fetchStop));
    const stopData = {};
    stops.forEach((stop, i) => {
        if (results[i].status === 'fulfilled') stopData[stop] = results[i].value;
        else console.error(`Stop ${stop} fetch failed:`, results[i].reason);
    });

    // Render each block
    blocks.forEach(block => {
        // Update section label
        const section = document.getElementById(block.sectionId);
        const labelEl = section?.querySelector('.section-label');
        if (labelEl) labelEl.innerHTML = block.sectionLabel;

        // Clear list and append matching items
        block.listEl.innerHTML = '';
        let appended = 0;
        let hasError = false;

        for (const row of block.rows) {
            const data = stopData[row.stop];
            if (!data) { hasError = true; continue; }
            const items = data
                .filter(i => i.ligne.numLigne === block.line && row.match(i.terminus.toLowerCase()))
                .slice(0, row.count);
            items.forEach((item, idx) => {
                block.listEl.appendChild(createTimeItem(item.temps, row.labelFn(idx), row.etaMin, row.etaLabel));
                appended++;
            });
        }

        if (!appended) {
            block.listEl.innerHTML = hasError
                ? '<div class="time-item error">Flux indisponible</div>'
                : '<div class="time-item empty">--</div>';
        }
    });

    lastUpdateEl.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

// Switch button handler
if (switchBtn) {
    switchBtn.addEventListener('click', () => {
        switchMode = !switchMode;
        switchBtn.classList.toggle('active', switchMode);
        switchBtn.setAttribute('aria-pressed', String(switchMode));
        document.querySelector('.dashboard').classList.toggle('switch-active', switchMode);
        // Show skeletons while re-fetching
        getBlocks().forEach(b => {
            b.listEl.innerHTML = '<div class="time-item skeleton"></div>';
        });
        fetchAllTransport();
    });
}

// --- WEATHER ---
const WEATHER_SYMBOLS = {
    0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
    45: '🌫️', 48: '🌫️',
    51: '🌦️', 53: '🌦️', 55: '🌧️',
    61: '🌧️', 63: '🌧️', 65: '🌧️',
    71: '❄️', 73: '❄️', 75: '❄️',
    80: '🌦️', 81: '🌦️', 82: '⛈️',
    95: '⚡', 96: '⚡', 99: '⚡',
};

const WEATHER_LABELS = {
    0: 'Ciel dégagé', 1: 'Peu nuageux', 2: 'Partiellement nuageux', 3: 'Couvert',
    45: 'Brouillard', 48: 'Brouillard givrant',
    51: 'Bruine légère', 53: 'Bruine modérée', 55: 'Bruine dense',
    61: 'Pluie faible', 63: 'Pluie modérée', 65: 'Pluie forte',
    71: 'Neige faible', 73: 'Neige modérée', 75: 'Neige forte',
    80: 'Averses légères', 81: 'Averses modérées', 82: 'Averses violentes',
    95: 'Orageux', 96: 'Orage avec grêle', 99: 'Orage avec forte grêle',
};

const fetchWeather = async () => {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current_weather=true&hourly=precipitation_probability,weathercode,temperature_2m&timezone=Europe%2FParis`;
        const response = await fetch(url);
        const data = await response.json();
        const current = data.current_weather;

        // Entre 22h et 7h du matin : afficher la météo à partir de 7h
        //   - 22h–23h59 : 7h du LENDEMAIN (calendaire)
        //   - 0h–6h59   : 7h du MÊME JOUR (on est déjà "ce matin")
        const now = new Date();
        const hourlyTimes = data.hourly.time || [];
        const h = now.getHours();
        const nightMode = h >= 22 || h < 7;

        let startIdx;
        if (nightMode) {
            const targetDate = new Date(now);
            if (h >= 22) targetDate.setDate(targetDate.getDate() + 1); // soir → lendemain
            // sinon h < 7 → même jour, 7h ce matin
            const y = targetDate.getFullYear();
            const m = String(targetDate.getMonth() + 1).padStart(2, '0');
            const d = String(targetDate.getDate()).padStart(2, '0');
            const targetISO = `${y}-${m}-${d}T07`;
            startIdx = hourlyTimes.findIndex(t => t.slice(0, 13) === targetISO);
            if (startIdx < 0) startIdx = h >= 22 ? (24 - h + 7) : (7 - h); // fallback
        } else {
            // Utiliser l'heure LOCALE (Open-Meteo renvoie Europe/Paris, pas UTC)
            const yy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const currentHourISO = `${yy}-${mm}-${dd}T${hh}`;
            startIdx = hourlyTimes.findIndex(t => t.slice(0, 13) === currentHourISO);
            if (startIdx < 0) startIdx = now.getHours();
        }

        const proba = data.hourly.precipitation_probability[startIdx] ?? 0;
        const displayCode = nightMode ? (data.hourly.weathercode[startIdx] ?? 0) : current.weathercode;
        const displayTemp = nightMode
            ? (data.hourly.temperature_2m?.[startIdx] ?? current.temperature)
            : current.temperature;
        const symbol = WEATHER_SYMBOLS[displayCode] ?? '🌡️';
        const label = WEATHER_LABELS[displayCode] ?? 'Météo';

        // Timeline : en mode nuit on part de 8h (offsets 1..5 = 9h–13h), sinon +1h à +5h
        const hoursHtml = [1, 2, 3, 4, 5].map(offset => {
            const idx = startIdx + offset;
            const t = hourlyTimes[idx];
            if (!t) return '';
            const hour = t.slice(11, 13); // 'HH'
            const p = data.hourly.precipitation_probability[idx] ?? 0;
            const code = data.hourly.weathercode[idx] ?? 0;
            const icon = WEATHER_SYMBOLS[code] ?? '🌡️';
            const rainClass = p >= 50 ? 'high' : p >= 20 ? 'mid' : 'low';
            return `
                <div class="hour">
                    <span class="hour-time">${hour}h</span>
                    <span class="hour-icon">${icon}</span>
                    <span class="hour-rain rain-${rainClass}">${p}%</span>
                </div>`;
        }).join('');

        weatherEl.innerHTML = `
            <div class="weather-info">
                <span class="weather-icon">${symbol}</span>
                <div class="weather-text">
                    <span class="temp">${Math.round(displayTemp)}°C</span>
                    <span class="condition">${nightMode ? `${h >= 22 ? 'Demain' : 'Ce matin'} 7h · ${label}` : label}</span>
                    <span class="rain-proba">💧 ${proba}% pluie</span>
                </div>
            </div>
            <div class="weather-hourly">${hoursHtml}</div>
        `;
    } catch (error) {
        console.error('Weather fetch error:', error);
        weatherEl.innerHTML = '<div class="weather-error">--</div>';
    }
};

// --- FINANCIAL DATA ---

// Helper: fetch a Yahoo Finance daily chart (35 jours → permet rolling 30j)
const fetchYahooChart = (symbol) =>
    fetch(`https://corsproxy.io/?url=https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d%26range=35d`)
        .then(r => r.json());

// Helper: extraire le prix actuel + variation rolling 30j à partir de données journalières
// Retourne { current, change, days } où days = période réelle utilisée (en jours)
const parse30dChange = (data) => {
    const result     = data.chart.result[0];
    const timestamps = result.timestamp;                          // Unix seconds
    const closes     = result.indicators.quote[0].close;

    // Dernière clôture non nulle
    let latestIdx = closes.length - 1;
    while (latestIdx > 0 && !closes[latestIdx]) latestIdx--;

    const latestTs = timestamps[latestIdx];
    const target30 = latestTs - 30 * 86400; // 30 jours en arrière

    // Clôture la plus proche de J-30 parmi les données disponibles
    let prevIdx = 0, minDiff = Infinity;
    for (let i = 0; i < latestIdx; i++) {
        if (!closes[i]) continue;
        const diff = Math.abs(timestamps[i] - target30);
        if (diff < minDiff) { minDiff = diff; prevIdx = i; }
    }

    const current = closes[latestIdx];
    const prev    = closes[prevIdx];
    const days    = Math.round((timestamps[latestIdx] - timestamps[prevIdx]) / 86400);
    return { current, change: ((current - prev) / prev) * 100, days };
};

// Helper: build a market card HTML string
const buildCard = (name, priceStr, change, period = '') => `
    <div class="market-card">
        <span class="market-name">${name}</span>
        <span class="market-price">${priceStr}</span>
        ${formatVariation(change, period)}
    </div>`;

const buildErrorCard = (name) =>
    `<div class="market-card"><span class="market-error">${name} --</span></div>`;

const fetchMarket = async () => {
    const [eurUsdRes, tslaRes, spRes, ethRes, fundFrRes, nasdaqRes, sx5eRes, fundEuRes] = await Promise.allSettled([
        fetchYahooChart('EURUSD%3DX'),                    // EUR/USD
        fetchYahooChart('TSLA'),                           // Tesla
        fetchYahooChart('%5EGSPC'),                        // S&P 500
        fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ethereum&price_change_percentage=30d').then(r => r.json()),
        fetchYahooChart('0P00001UFS.F'),                   // Indép. AM France Small & Mid A (Frankfurt)
        fetchYahooChart('%5EIXIC'),                        // Nasdaq Composite
        fetchYahooChart('%5ESTOXX50E'),                    // Euro Stoxx 50 (SX5E)
        fetchYahooChart('0P0001DKPN.F'),                   // Indép. AM Europe Small I/C (Frankfurt)
    ]);

    // Ligne du haut : S&P 500 + Ethereum (+ Gazole via fuelEl)
    let htmlTop = '';
    try {
        const { current, change, days } = parse30dChange(spRes.value);
        htmlTop += buildCard('S&amp;P 500', Math.round(current).toLocaleString('fr-FR'), change, `${days}j`);
    } catch { htmlTop += buildErrorCard('S&P'); }
    try {
        const ethData   = ethRes.value[0];
        const ethChange = ethData.price_change_percentage_30d_in_currency ?? ethData.price_change_percentage_30d;
        htmlTop += buildCard('Ξ Ethereum', `$${Math.round(ethData.current_price).toLocaleString('fr-FR')}`, ethChange, '30j');
    } catch { htmlTop += buildErrorCard('ETH'); }

    // Barre du bas : EUR/USD | Nasdaq | SX5E | TSLA | Indép. AM France | Indép. AM Europe
    let htmlExtra = '';
    try {
        const { current, change, days } = parse30dChange(eurUsdRes.value);
        htmlExtra += buildCard('EUR / USD', current.toFixed(4), change, `${days}j`);
    } catch { htmlExtra += buildErrorCard('EUR/USD'); }
    try {
        const { current, change, days } = parse30dChange(nasdaqRes.value);
        htmlExtra += buildCard('Nasdaq', Math.round(current).toLocaleString('fr-FR'), change, `${days}j`);
    } catch { htmlExtra += buildErrorCard('Nasdaq'); }
    try {
        const { current, change, days } = parse30dChange(sx5eRes.value);
        htmlExtra += buildCard('SX5E', Math.round(current).toLocaleString('fr-FR'), change, `${days}j`);
    } catch { htmlExtra += buildErrorCard('SX5E'); }
    try {
        const { current, change, days } = parse30dChange(tslaRes.value);
        htmlExtra += buildCard('TSLA', `$${Math.round(current).toLocaleString('fr-FR')}`, change, `${days}j`);
    } catch { htmlExtra += buildErrorCard('TSLA'); }
    try {
        const { current, change, days } = parse30dChange(fundFrRes.value);
        htmlExtra += buildCard('Indép. France', `€${current.toFixed(2)}`, change, `${days}j`);
    } catch { htmlExtra += buildErrorCard('Indép. France'); }
    try {
        const { current, change, days } = parse30dChange(fundEuRes.value);
        htmlExtra += buildCard('Indép. Europe', `€${current.toFixed(2)}`, change, `${days}j`);
    } catch { htmlExtra += buildErrorCard('Indép. Europe'); }

    // Réinsérer fuel-data en premier (innerHTML écrase le DOM existant)
    marketEl.innerHTML = htmlTop;
    marketEl.prepend(fuelEl);
    if (marketExtraEl) marketExtraEl.innerHTML = htmlExtra;
};

// --- INITIALIZATION ---
updateClock();
setInterval(updateClock, 1000);

fetchAllTransport();
fetchWeather();
fetchMarket();

setInterval(fetchAllTransport, 30_000); // 30s
setInterval(fetchWeather, 900_000);     // 15min
setInterval(fetchMarket, 600_000);      // 10min

// --- BANNER (TAN alerts → fallback to today's agenda) ---
const RELEVANT_LINES = ['3'];
const ICAL_URL = import.meta.env.VITE_ICAL_URL;

// Extract affected line numbers from a TAN alert payload
const alertLines = (a) => {
    const lines = new Set();
    try {
        const la = JSON.parse(a.listes_arrets || '{}').LISTE_ARRETS;
        (Array.isArray(la) ? la : [la]).filter(Boolean).forEach(x => x.LIGNE && lines.add(String(x.LIGNE)));
    } catch { }
    (a.troncons || '').match(/\[([^/]+)\//g)?.forEach(m => {
        const n = m.slice(1, -1);
        if (n && n !== '-') lines.add(n);
    });
    return [...lines];
};

const fetchTanAlerts = async () => {
    const url = 'https://data.nantesmetropole.fr/api/explore/v2.1/catalog/datasets/244400404_info-trafic-tan-temps-reel/records?limit=100';
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const today = new Date().toISOString().slice(0, 10);
    return (data.results || []).filter(a => {
        if (a.perturbation_terminee !== 0) return false;
        if (a.date_debut && a.date_debut > today) return false;
        if (a.date_fin && a.date_fin < today) return false;
        return alertLines(a).some(l => RELEVANT_LINES.includes(l));
    });
};

// --- Minimal iCal parser (VEVENT only, basic DAILY/WEEKLY recurrence) ---
const parseICSDate = (value, params = []) => {
    const isDate = params.some(p => p === 'VALUE=DATE');
    if (isDate) {
        return new Date(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6, 8));
    }
    const y = value.slice(0, 4), mo = value.slice(4, 6), d = value.slice(6, 8);
    const h = value.slice(9, 11) || '00', mi = value.slice(11, 13) || '00', s = value.slice(13, 15) || '00';
    const suffix = value.endsWith('Z') ? 'Z' : '';
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${suffix}`);
};

const parseICS = (text) => {
    const raw = text.replace(/\r/g, '').split('\n');
    // Unfold continuation lines (leading space/tab)
    const lines = raw.reduce((acc, l) => {
        if ((l.startsWith(' ') || l.startsWith('\t')) && acc.length) acc[acc.length - 1] += l.slice(1);
        else acc.push(l);
        return acc;
    }, []);

    const events = [];
    let ev = null;
    for (const line of lines) {
        if (line === 'BEGIN:VEVENT') ev = { allDay: false };
        else if (line === 'END:VEVENT') { if (ev) events.push(ev); ev = null; }
        else if (ev) {
            const i = line.indexOf(':');
            if (i < 0) continue;
            const keyRaw = line.slice(0, i), value = line.slice(i + 1);
            const parts = keyRaw.split(';');
            const key = parts[0], params = parts.slice(1);
            if (key === 'SUMMARY') ev.summary = value;
            else if (key === 'DTSTART') {
                ev.start = parseICSDate(value, params);
                ev.allDay = params.some(p => p === 'VALUE=DATE');
            }
            else if (key === 'DTEND') ev.end = parseICSDate(value, params);
            else if (key === 'RRULE') {
                ev.rrule = Object.fromEntries(value.split(';').map(p => p.split('=')));
            }
        }
    }
    return events;
};

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Return the occurrence time (Date) of ev on target day (midnight local), or null
const occurrenceOnDate = (ev, target) => {
    if (!ev.start) return null;
    const tStart = target.getTime();           // midnight of target day
    const tEnd   = tStart + 86400000;          // midnight of next day (exclusive)

    if (!ev.rrule) {
        if (ev.allDay) {
            // iCal all-day: DTSTART is inclusive, DTEND is exclusive (next day)
            const evS = new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate()).getTime();
            const evE = ev.end
                ? new Date(ev.end.getFullYear(), ev.end.getMonth(), ev.end.getDate()).getTime()
                : evS + 86400000;
            return (tStart >= evS && tStart < evE) ? ev.start : null;
        }
        // Timed event: show on any day the event overlaps (handles multi-day events)
        const ms    = ev.start.getTime();
        const msEnd = ev.end ? ev.end.getTime() : ms + 3600000;
        return (ms < tEnd && msEnd > tStart) ? ev.start : null;
    }

    // --- Recurring ---
    // Event hasn't started yet on this target day
    const evStartDay = new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate()).getTime();
    if (tStart < evStartDay) return null;

    // Past UNTIL
    if (ev.rrule.UNTIL) {
        const until = parseICSDate(ev.rrule.UNTIL, []);
        const untilDay = new Date(until.getFullYear(), until.getMonth(), until.getDate()).getTime();
        if (tStart > untilDay) return null;
    }

    const build = () => {
        const o = new Date(target);
        if (!ev.allDay) o.setHours(ev.start.getHours(), ev.start.getMinutes(), 0, 0);
        return o;
    };

    const freq = ev.rrule.FREQ;
    if (freq === 'DAILY') {
        // Sans UNTIL ni COUNT : plafonner à 90 jours après le début
        // (évite les rappels oubliés d'années passées sans bloquer les nouvelles récurrences)
        if (!ev.rrule.UNTIL && !ev.rrule.COUNT) {
            if (tStart > evStartDay + 90 * 86400000) return null;
        }
        return build();
    }
    if (freq === 'WEEKLY') {
        const byDay = ev.rrule.BYDAY
            ? ev.rrule.BYDAY.split(',').map(s => s.replace(/^[+-]?\d+/, ''))
            : [DAY_CODES[ev.start.getDay()]];
        return byDay.includes(DAY_CODES[target.getDay()]) ? build() : null;
    }
    if (freq === 'MONTHLY') {
        return ev.start.getDate() === target.getDate() ? build() : null;
    }
    if (freq === 'YEARLY') {
        return (ev.start.getMonth() === target.getMonth() && ev.start.getDate() === target.getDate())
            ? build() : null;
    }
    return null;
};

// Plusieurs proxies CORS en fallback (les proxies publics sont instables)
const CORS_PROXIES = [
    u => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
];

const fetchViaProxies = async (url) => {
    const errors = [];
    for (const build of CORS_PROXIES) {
        try {
            const r = await fetch(build(url));
            if (!r.ok) { errors.push(`${build.name || 'proxy'} HTTP ${r.status}`); continue; }
            const text = await r.text();
            if (!text || text.length < 20) { errors.push('empty body'); continue; }
            return text;
        } catch (e) {
            errors.push(e.message);
        }
    }
    throw new Error(`Tous les proxies CORS ont échoué: ${errors.join(' | ')}`);
};

const fetchAgenda = async () => {
    if (!ICAL_URL) return [];
    const text = await fetchViaProxies(ICAL_URL);
    const events = parseICS(text);
    console.log(`[Agenda] ${events.length} événements parsés dans l'iCal`);

    const now = new Date();
    const todayMidnight    = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowMidnight = new Date(todayMidnight.getTime() + 86400000);

    // À partir de 20h on affiche aussi les événements de demain
    const targets = now.getHours() >= 20
        ? [{ date: todayMidnight, isTomorrow: false }, { date: tomorrowMidnight, isTomorrow: true }]
        : [{ date: todayMidnight, isTomorrow: false }];

    // Debug: log all events with their RRULE to help diagnose
    console.log('[Agenda] Tous les événements parsés:');
    events.forEach(ev => {
        const rruleStr = ev.rrule ? JSON.stringify(ev.rrule) : 'none';
        console.log(`  • "${ev.summary}" | start=${ev.start?.toISOString()} | end=${ev.end?.toISOString() ?? 'none'} | allDay=${ev.allDay} | rrule=${rruleStr}`);
    });

    const result = [];
    for (const { date, isTomorrow } of targets) {
        for (const ev of events) {
            const occ = occurrenceOnDate(ev, date);
            if (occ) {
                console.log(`[Agenda] ✅ retenu: "${ev.summary}" pour ${date.toDateString()}`);
                result.push({ ...ev, occurrence: occ, isTomorrow });
            } else {
                console.log(`[Agenda] ❌ filtré: "${ev.summary}" pour ${date.toDateString()}`);
            }
        }
    }

    const sorted = result.sort((a, b) => {
        if (a.isTomorrow !== b.isTomorrow) return a.isTomorrow ? 1 : -1;
        return a.occurrence - b.occurrence;
    });
    console.log(`[Agenda] ${sorted.length} événement(s) retenu(s) pour aujourd'hui${targets.length > 1 ? ' + demain' : ''}`);
    return sorted;
};

// --- BIRTHDAYS (birthdays.csv — généré depuis .data/birthdays.xlsx via gen_birthdays.py) ---
const fetchBirthdays = async () => {
    const r = await fetch('./birthdays.csv');
    if (!r.ok) throw new Error(`birthdays.csv HTTP ${r.status}`);
    const text = await r.text();
    const [headerLine, ...lines] = text.trim().split('\n');

    // Détection dynamique des colonnes (insensible à la casse)
    const headers = headerLine.split(',').map(h => h.trim().toLowerCase());
    const iName   = headers.indexOf('name');
    const iMonth  = headers.indexOf('month');
    const iDay    = headers.indexOf('day');
    const iYear   = headers.indexOf('birth_year');
    const iDisp   = headers.indexOf('display');

    const now   = new Date();
    const month = now.getMonth() + 1;  // 1-12
    const day   = now.getDate();

    return lines
        .map(line => {
            const parts = line.trim().split(',');
            if (parts.length < 3) return null;
            const display = iDisp >= 0 ? parseInt(parts[iDisp], 10) : 1;
            if (display === 0) return null;  // masqué explicitement
            return {
                name:      (iName  >= 0 ? parts[iName]  : parts[0]).trim(),
                month:     parseInt(iMonth >= 0 ? parts[iMonth] : parts[1], 10),
                day:       parseInt(iDay   >= 0 ? parts[iDay]   : parts[2], 10),
                birthYear: (iYear  >= 0 && parts[iYear]?.trim()) ? parseInt(parts[iYear], 10) : null,
            };
        })
        .filter(b => b && b.month === month && b.day === day);
};

const renderBanner = async () => {
    // Fetch en parallèle — indépendants
    const [alertRes, agendaRes, bdayRes] = await Promise.allSettled([
        fetchTanAlerts(), fetchAgenda(), fetchBirthdays()
    ]);

    const parts = [];

    // 1. Agenda
    if (agendaRes.status === 'fulfilled' && agendaRes.value.length) {
        const events  = agendaRes.value;
        const fmt = (ev) => {
            const pfx = ev.isTomorrow ? 'Demain · ' : '';
            if (ev.allDay) return `<strong>${pfx}${ev.summary || 'Événement'}</strong>`;
            const t = ev.occurrence.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            return `<strong>${pfx}${t}</strong> ${ev.summary || ''}`;
        };
        const preview = events.slice(0, 3).map(fmt).join(' • ');
        const extra   = events.length > 3 ? `<span class="banner-count">+${events.length - 3}</span>` : '';
        parts.push(`
            <div class="banner-row banner--agenda">
                <span class="banner-icon">📅</span>
                <span class="banner-text">${preview}${extra}</span>
            </div>`);
    } else if (agendaRes.status === 'rejected') {
        console.error('Agenda error:', agendaRes.reason);
    }

    // 2. Anniversaires
    if (bdayRes.status === 'fulfilled' && bdayRes.value.length) {
        const now  = new Date();
        const year = now.getFullYear();
        const fmt  = b => {
            const age = b.birthYear ? ` · <strong>${year - b.birthYear} ans</strong>` : '';
            return `<strong>${b.name}</strong>${age}`;
        };
        const preview = bdayRes.value.slice(0, 4).map(fmt).join(' • ');
        const extra   = bdayRes.value.length > 4
            ? `<span class="banner-count">+${bdayRes.value.length - 4}</span>` : '';
        parts.push(`
            <div class="banner-row banner--birthday">
                <span class="banner-icon">🎂</span>
                <span class="banner-text">${preview}${extra}</span>
            </div>`);
    } else if (bdayRes.status === 'rejected') {
        console.warn('Birthdays error:', bdayRes.reason);
    }

    // 3. Alertes TAN
    if (alertRes.status === 'fulfilled' && alertRes.value.length) {
        const alerts = alertRes.value;
        const first  = alerts[0];
        const title  = first.texte_vocal || first.intitule || 'Perturbation en cours';
        const count  = alerts.length > 1 ? `<span class="banner-count">+${alerts.length - 1}</span>` : '';
        parts.push(`
            <div class="banner-row banner--alert">
                <span class="banner-icon">⚠️</span>
                <span class="banner-text"><strong>Trafic TAN</strong> — ${title}${count}</span>
            </div>`);
    } else if (alertRes.status === 'rejected') {
        console.error('TAN alerts error:', alertRes.reason);
    }

    if (parts.length) {
        bannerEl.className = 'banner';
        bannerEl.innerHTML = parts.join('');
        bannerEl.hidden = false;
    } else {
        bannerEl.hidden = true;
    }
};

renderBanner();
setInterval(renderBanner, 300_000); // 5 min

// --- REAL ESTATE (DVF open data, pre-computed) ---
// Values from Haversine filter around Félix Faure — refreshed annually.

const renderImmo = () => {
    const buildImmoCard = (label, history) => {
        const years = Object.keys(history).map(Number).sort();
        const latest = years.at(-1);
        const prev   = years.at(-2);
        const [ppm2_cur,  tx_cur]  = history[latest];
        const [ppm2_prev] = history[prev];
        const pct = ((ppm2_cur - ppm2_prev) / ppm2_prev * 100).toFixed(1);
        const sign = pct >= 0 ? '+' : '';
        const cls  = pct >= 0 ? 'positive' : 'negative';
        const arrow = pct >= 0 ? '▲' : '▼';

        // Mini sparkline textuel : une ligne par année
        const rows = years.map(y => {
            const [ppm2, tx] = history[y];
            const bar = '█'.repeat(Math.round(ppm2 / 1000)) + '░'.repeat(Math.max(0, 6 - Math.round(ppm2 / 1000)));
            return `<div class="immo-row ${y === latest ? 'immo-row--cur' : ''}">
                <span class="immo-year">${y}</span>
                <span class="immo-ppm2">${ppm2.toLocaleString('fr-FR')} €/m²</span>
                <span class="immo-tx">${tx} tx</span>
            </div>`;
        }).join('');

        return `<div class="market-card immo-card">
            <span class="market-name">${label}</span>
            <div class="immo-table">${rows}</div>
            <span class="variation ${cls}">${arrow} ${sign}${pct}% vs ${prev}</span>
        </div>`;
    };

    immoEl.innerHTML =
        buildImmoCard('Appartements · r=800m', IMMO_HISTORY.appart) +
        buildImmoCard('Maisons · r=1500m', IMMO_HISTORY.maison);
};

renderImmo();

// --- EXTRA BAR TOGGLE (données supplémentaires + immo) ---
const extraToggleBtn  = document.getElementById('extra-toggle');
const extraArrowEl    = document.getElementById('extra-toggle-arrow');
if (extraToggleBtn && extraBarEl) {
    const EXTRA_KEY = 'extraBarVisible';
    const setExtraVisible = (visible) => {
        extraBarEl.classList.toggle('extra-bar--hidden', !visible);
        extraToggleBtn.setAttribute('aria-pressed', String(visible));
        if (extraArrowEl) extraArrowEl.textContent = visible ? '▲' : '▼';
        localStorage.setItem(EXTRA_KEY, visible ? '1' : '0');
    };
    // Restore saved state (visible by default)
    setExtraVisible(localStorage.getItem(EXTRA_KEY) !== '0');
    extraToggleBtn.addEventListener('click', () => {
        setExtraVisible(extraBarEl.classList.contains('extra-bar--hidden'));
    });
}

// --- FUEL PRICE (gazole le moins cher autour de Nantes) ---
// Source : data.economie.gouv.fr — flux instantané des prix carburants
const fetchFuel = async () => {
    try {
        // Recherche dans un rayon de 10 km autour du centre de Nantes
        const lat = 47.2091, lon = -1.5573;
        const where = `within_distance(geom, geom'POINT(${lon} ${lat})', 10km) AND gazole_prix IS NOT NULL`;
        const url = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records?where=${encodeURIComponent(where)}&order_by=gazole_prix%20asc&limit=1`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        const rec = data.results?.[0];
        if (!rec) { fuelEl.innerHTML = buildErrorCard('Gazole'); return; }

        const price = Number(rec.gazole_prix).toFixed(3).replace('.', ',');
        const ville = (rec.ville || '').split(' ')[0]; // nom court
        fuelEl.innerHTML = `
            <div class="market-card">
                <span class="market-name">Gazole mini</span>
                <span class="market-price">${price} €</span>
                <span class="variation neutral">${ville}</span>
            </div>`;
    } catch (e) {
        console.error('Fuel fetch error:', e);
        fuelEl.innerHTML = buildErrorCard('Gazole');
    }
};

fetchFuel();
setInterval(fetchFuel, 3_600_000); // 1h
