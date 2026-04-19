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
const immoEl = document.getElementById('immo-data');
const fuelEl = document.getElementById('fuel-data');
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

const formatVariation = (pct) => {
    const sign = pct >= 0 ? '+' : '';
    const cls = pct >= 0 ? 'positive' : 'negative';
    const arrow = pct >= 0 ? '▲' : '▼';
    return `<span class="variation ${cls}">${arrow} ${sign}${pct.toFixed(2)}%</span>`;
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

        // À partir de 22h, on bascule sur la météo de demain à partir de 8h
        const now = new Date();
        const hourlyTimes = data.hourly.time || [];
        const nightMode = now.getHours() >= 22;

        let startIdx;
        if (nightMode) {
            // Cherche l'index correspondant à demain 8h local
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const y = tomorrow.getFullYear();
            const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
            const d = String(tomorrow.getDate()).padStart(2, '0');
            const targetISO = `${y}-${m}-${d}T08`;
            startIdx = hourlyTimes.findIndex(t => t.slice(0, 13) === targetISO);
            if (startIdx < 0) startIdx = 24 + 8 - now.getHours(); // fallback approx
        } else {
            const currentHourISO = now.toISOString().slice(0, 13);
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
                    <span class="condition">${nightMode ? `Demain 8h · ${label}` : label}</span>
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

// Helper: fetch a Yahoo Finance monthly chart
const fetchYahooChart = (symbol) =>
    fetch(`https://corsproxy.io/?url=https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo%26range=2mo`)
        .then(r => r.json());

// Helper: extract current price + monthly % change from Yahoo chart response
const parseMonthlyChange = (data) => {
    const prices = data.chart.result[0].indicators.quote[0].close.filter(Boolean);
    const current = prices[prices.length - 1];
    const prev = prices[prices.length - 2];
    return { current, change: ((current - prev) / prev) * 100 };
};

// Helper: build a market card HTML string
const buildCard = (name, priceStr, change) => `
    <div class="market-card">
        <span class="market-name">${name}</span>
        <span class="market-price">${priceStr}</span>
        ${formatVariation(change)}
    </div>`;

const buildErrorCard = (name) =>
    `<div class="market-card"><span class="market-error">${name} --</span></div>`;

const fetchMarket = async () => {
    const [eurUsdRes, tslaRes, spRes, ethRes, fundRes] = await Promise.allSettled([
        fetchYahooChart('EURUSD%3DX'),                    // EUR/USD
        fetchYahooChart('TSLA'),                           // Tesla
        fetchYahooChart('%5EGSPC'),                        // S&P 500
        fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ethereum&price_change_percentage=30d').then(r => r.json()),
        fetchYahooChart('0P00001UFS.F'),                   // Indépendance AM France Small & Mid A (Frankfurt)
    ]);

    let html = '';

    // EUR/USD
    try {
        const { current, change } = parseMonthlyChange(eurUsdRes.value);
        html += buildCard('EUR / USD', current.toFixed(4), change);
    } catch { html += buildErrorCard('EUR/USD'); }

    // TSLA
    try {
        const { current, change } = parseMonthlyChange(tslaRes.value);
        html += buildCard('TSLA', `$${Math.round(current).toLocaleString('fr-FR')}`, change);
    } catch { html += buildErrorCard('TSLA'); }

    // S&P 500
    try {
        const { current, change } = parseMonthlyChange(spRes.value);
        html += buildCard('S&amp;P 500', Math.round(current).toLocaleString('fr-FR'), change);
    } catch { html += buildErrorCard('S&P'); }

    // Ethereum
    try {
        const ethData = ethRes.value[0];
        const ethChange = ethData.price_change_percentage_30d_in_currency ?? ethData.price_change_percentage_30d;
        html += buildCard('Ξ Ethereum', `$${Math.round(ethData.current_price).toLocaleString('fr-FR')}`, ethChange);
    } catch { html += buildErrorCard('ETH'); }

    // Fonds Indépendance AM France Small & Mid A (LU0131510165)
    try {
        const { current, change } = parseMonthlyChange(fundRes.value);
        html += buildCard('Indép. AM', `€${current.toFixed(2)}`, change);
    } catch { html += buildErrorCard('Indép. AM'); }

    marketEl.innerHTML = html;
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
        // Timed event: check timestamp falls in target day
        const ms = ev.start.getTime();
        return (ms >= tStart && ms < tEnd) ? ev.start : null;
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
    if (freq === 'DAILY') return build();
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

    const result = [];
    for (const { date, isTomorrow } of targets) {
        for (const ev of events) {
            const occ = occurrenceOnDate(ev, date);
            if (occ) result.push({ ...ev, occurrence: occ, isTomorrow });
        }
    }

    const sorted = result.sort((a, b) => {
        if (a.isTomorrow !== b.isTomorrow) return a.isTomorrow ? 1 : -1;
        return a.occurrence - b.occurrence;
    });
    console.log(`[Agenda] ${sorted.length} événement(s) retenu(s) pour aujourd'hui${targets.length > 1 ? ' + demain' : ''}`);
    return sorted;
};

const renderBanner = async () => {
    // Fetch both in parallel — they're independent
    const [alertRes, agendaRes] = await Promise.allSettled([fetchTanAlerts(), fetchAgenda()]);

    const parts = [];

    // TAN alerts row
    if (alertRes.status === 'fulfilled' && alertRes.value.length) {
        const alerts = alertRes.value;
        const first = alerts[0];
        const title = first.texte_vocal || first.intitule || 'Perturbation en cours';
        const count = alerts.length > 1 ? `<span class="banner-count">+${alerts.length - 1}</span>` : '';
        parts.push(`
            <div class="banner-row banner--alert">
                <span class="banner-icon">⚠️</span>
                <span class="banner-text"><strong>Trafic TAN</strong> — ${title}${count}</span>
            </div>`);
    } else if (alertRes.status === 'rejected') {
        console.error('TAN alerts error:', alertRes.reason);
    }

    // Agenda row
    if (agendaRes.status === 'fulfilled' && agendaRes.value.length) {
        const events = agendaRes.value;
        const fmt = (ev) => {
            const pfx = ev.isTomorrow ? 'Demain · ' : '';
            if (ev.allDay) return `<strong>${pfx}${ev.summary || 'Événement'}</strong>`;
            const t = ev.occurrence.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            return `<strong>${pfx}${t}</strong> ${ev.summary || ''}`;
        };
        const preview = events.slice(0, 3).map(fmt).join(' • ');
        const extra = events.length > 3 ? `<span class="banner-count">+${events.length - 3}</span>` : '';
        parts.push(`
            <div class="banner-row banner--agenda">
                <span class="banner-icon">📅</span>
                <span class="banner-text">${preview}${extra}</span>
            </div>`);
    } else if (agendaRes.status === 'rejected') {
        console.error('Agenda error:', agendaRes.reason);
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
