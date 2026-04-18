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
// Source: files.data.gouv.fr/geo-dvf/latest/csv/{year}/communes/44/44109.csv
// Method: Haversine filter around Félix Faure (47.2091, -1.5573)
//   Maisons  : r=1500m — 20 tx (2025), 26 tx (2024)   avg €/m²
//   Apparts  : r=600m  — 194 tx (2025), 172 tx (2024)  avg €/m²
// Last updated: April 2026 — refresh annually when DVF data updates
const IMMO = {
    maison:  { ppm2_cur: 6095, ppm2_prev: 5413, surface: 200 },  // 2025 vs 2024 (+12,6% — 20 tx)
    appart:  { ppm2_cur: 4024, ppm2_prev: 4136, surface: 100 },  // 2025 vs 2024 (−2,7% — 194 tx)
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
const fetchTransport = async () => {
    try {
        const response = await fetch(`https://open.tan.fr/ewp/tempsattente.json/${STOP_CODE}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        // Clear previous entries
        neustrieList.innerHTML = '';
        marcelPaulList.innerHTML = '';
        busListEl.innerHTML = '';

        if (!data || data.length === 0) {
            neustrieList.innerHTML = '<div class="time-item empty">--</div>';
            marcelPaulList.innerHTML = '<div class="time-item empty">--</div>';
            busListEl.innerHTML = '<div class="time-item empty">--</div>';
            return;
        }

        const counts = { n: 0, mp: 0 };

        // Sort tram lines first
        data.forEach(item => {
            const line = item.ligne.numLigne;
            const terminus = item.terminus.toLowerCase();

            if (line === '3' && (terminus.includes('neustrie') || terminus.includes('rezé')) && counts.n < 2) {
                const label = counts.n === 0 ? 'Prochain' : 'Suivant';
                neustrieList.appendChild(createTimeItem(item.temps, label, FFAU_TO_COMM_MIN, 'Commerce'));
                counts.n++;
            } else if (line === '3' && terminus.includes('marcel paul') && counts.mp < 2) {
                const label = counts.mp === 0 ? 'Prochain' : 'Suivant';
                marcelPaulList.appendChild(createTimeItem(item.temps, label, FFAU_TO_SILL_MIN, 'Sillon'));
                counts.mp++;
            }
        });

        // Bus 26: Hôtel de Région first, then Jonelière
        const busHotel = data.filter(i => i.ligne.numLigne === '26' && i.terminus.toLowerCase().includes('région')).slice(0, 2);
        const busJon = data.filter(i => i.ligne.numLigne === '26' && i.terminus.toLowerCase().includes('jonelière')).slice(0, 1);

        busHotel.forEach(item => busListEl.appendChild(createTimeItem(item.temps, 'H. Région', FFAU_TO_DLME_MIN, 'Delorme')));
        busJon.forEach(item => busListEl.appendChild(createTimeItem(item.temps, 'Jonelière', FFAU_TO_JNLI_MIN, 'Jonelière')));

        // Fallback empty states
        if (!neustrieList.children.length) neustrieList.innerHTML = '<div class="time-item empty">--</div>';
        if (!marcelPaulList.children.length) marcelPaulList.innerHTML = '<div class="time-item empty">--</div>';
        if (!busListEl.children.length) busListEl.innerHTML = '<div class="time-item empty">--</div>';

        lastUpdateEl.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    } catch (error) {
        console.error('Transport fetch error:', error);
        const errorHtml = '<div class="time-item error">Flux indisponible</div>';
        neustrieList.innerHTML = errorHtml;
        marcelPaulList.innerHTML = errorHtml;
        busListEl.innerHTML = errorHtml;
    }
};

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
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current_weather=true&hourly=precipitation_probability&timezone=Europe%2FParis`;
        const response = await fetch(url);
        const data = await response.json();
        const current = data.current_weather;

        // Match precipitation probability to the current hour
        const currentHour = new Date().getHours();
        const proba = data.hourly.precipitation_probability[currentHour] ?? 0;

        const symbol = WEATHER_SYMBOLS[current.weathercode] ?? '🌡️';
        const label = WEATHER_LABELS[current.weathercode] ?? 'Météo';

        weatherEl.innerHTML = `
            <div class="weather-info">
                <span class="weather-icon">${symbol}</span>
                <div class="weather-text">
                    <span class="temp">${Math.round(current.temperature)}°C</span>
                    <span class="condition">${label}</span>
                    <span class="rain-proba">💧 ${proba}% pluie</span>
                </div>
            </div>
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

fetchTransport();
fetchWeather();
fetchMarket();

setInterval(fetchTransport, 30_000);   // 30s
setInterval(fetchWeather, 900_000);    // 15min
setInterval(fetchMarket, 600_000);     // 10min

// --- BUS C8 (Anatole France → Gare Sud / Saupin) ---
const fetchC8 = async () => {
    try {
        const response = await fetch(`https://open.tan.fr/ewp/tempsattente.json/${STOP_CODE_C8}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        c8ListEl.innerHTML = '';

        // Direction Gare Sud/Saupin = sens 2 (terminus "Saupin" ou "Gare Sud")
        const buses = data
            .filter(i => i.ligne.numLigne === 'C8' &&
                (i.terminus.toLowerCase().includes('saupin') ||
                 i.terminus.toLowerCase().includes('gare')))
            .slice(0, 2);

        if (!buses.length) {
            c8ListEl.innerHTML = '<div class="time-item empty">--</div>';
            return;
        }

        let count = 0;
        buses.forEach(item => {
            const label = count === 0 ? 'Prochain' : 'Suivant';
            c8ListEl.appendChild(createTimeItem(item.temps, label, AFRA_TO_SPIN_MIN, 'Saupin'));
            count++;
        });

    } catch (error) {
        console.error('C8 fetch error:', error);
        c8ListEl.innerHTML = '<div class="time-item error">Flux indisponible</div>';
    }
};

fetchC8();
setInterval(fetchC8, 30_000);

// --- REAL ESTATE (DVF open data, pre-computed) ---
// Values from Haversine filter around Félix Faure — refreshed annually.

const fmtImmoPrice = (euros) => euros >= 1e6
    ? `${(euros / 1e6).toFixed(2).replace('.', ',')} M€`
    : `${Math.round(euros / 1000)} K€`;

const renderImmo = () => {
    const { maison, appart } = IMMO;
    const changeM = ((maison.ppm2_cur - maison.ppm2_prev) / maison.ppm2_prev) * 100;
    const changeA = ((appart.ppm2_cur - appart.ppm2_prev) / appart.ppm2_prev) * 100;
    immoEl.innerHTML =
        buildCard(`Maison ${maison.surface}m²`, fmtImmoPrice(maison.ppm2_cur * maison.surface), changeM) +
        buildCard(`Appart. ${appart.surface}m²`, fmtImmoPrice(appart.ppm2_cur * appart.surface), changeA);
};

renderImmo();
