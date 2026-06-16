/**
 * Cloudflare Worker — proxy temps réel TAN/Naolib (SIRI → JSON)
 * --------------------------------------------------------------
 * L'ancienne API open.tan.fr/ewp/tempsattente.json a été coupée (déc. 2025).
 * Le remplacement officiel est le service SIRI sur api.okina.fr :
 *   - authentification par en-tête `apikey` (clé publique "opendata")
 *   - pas de CORS → inaccessible directement depuis le navigateur
 *   - requête POST en XML, réponse XML
 *   - quota strict : 1 requête / 30 s
 *
 * Ce worker fait l'intermédiaire : il interroge okina pour TOUS les quais
 * utiles en UNE seule requête SIRI groupée, met le résultat en cache 25 s
 * (respecte le quota même avec plusieurs visiteurs), convertit le XML en JSON
 * propre et ajoute les en-têtes CORS attendus par l'afficheur.
 *
 * Déploiement : voir worker/README.md
 */

const OKINA_URL = 'https://api.okina.fr/gateway/sem/realtime/anshar/services';
const API_KEY   = 'opendata';           // clé publique open data Nantes Métropole
const CACHE_TTL = 25;                    // secondes (< quota 30 s d'okina)

// Quai SIRI (FR_NAOLIB:Quay:N) → arrêt parent utilisé par l'afficheur.
// Couvre les deux sens de chaque arrêt (mode normal + mode inversé).
const QUAY_TO_STOP = {
    // Félix Faure (tram 3 + bus 26, les deux sens)
    'FR_NAOLIB:Quay:831': 'FFAU', 'FR_NAOLIB:Quay:829': 'FFAU',
    'FR_NAOLIB:Quay:828': 'FFAU', 'FR_NAOLIB:Quay:830': 'FFAU',
    // Anatole France (C8)
    'FR_NAOLIB:Quay:1400': 'AFRA', 'FR_NAOLIB:Quay:1401': 'AFRA', 'FR_NAOLIB:Quay:1402': 'AFRA',
    // Commerce (tram 3 — mode inversé)
    'FR_NAOLIB:Quay:90': 'COMM', 'FR_NAOLIB:Quay:91': 'COMM', 'FR_NAOLIB:Quay:92': 'COMM',
    'FR_NAOLIB:Quay:93': 'COMM', 'FR_NAOLIB:Quay:94': 'COMM', 'FR_NAOLIB:Quay:95': 'COMM',
    // Sillon de Bretagne (tram 3 — mode inversé)
    'FR_NAOLIB:Quay:998': 'SILL', 'FR_NAOLIB:Quay:999': 'SILL',
    'FR_NAOLIB:Quay:1000': 'SILL', 'FR_NAOLIB:Quay:1001': 'SILL',
    // Delorme (bus 26 — mode inversé)
    'FR_NAOLIB:Quay:1366': 'DLME', 'FR_NAOLIB:Quay:1367': 'DLME',
    // Jonelière (bus 26 — mode inversé)
    'FR_NAOLIB:Quay:1405': 'JNLI',
    // Saupin (C8 — mode inversé)
    'FR_NAOLIB:Quay:1862': 'SPIN', 'FR_NAOLIB:Quay:1863': 'SPIN',
};

// Lignes réellement affichées par arrêt — on ignore tout le reste (Commerce
// voit 7 lignes, on n'en garde qu'une) pour alléger la réponse.
const NEEDED_LINES = {
    FFAU: ['3', '26'], AFRA: ['C8'], COMM: ['3'],
    SILL: ['3'], DLME: ['26'], JNLI: ['26'], SPIN: ['C8'],
};

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const buildSiriRequest = () => {
    const reqs = Object.keys(QUAY_TO_STOP)
        .map(ref => `<StopMonitoringRequest version="2.0"><MonitoringRef>${ref}</MonitoringRef></StopMonitoringRequest>`)
        .join('');
    return `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Siri version="2.0" xmlns="http://www.siri.org.uk/siri">` +
        `<ServiceRequest><RequestorRef>${API_KEY}</RequestorRef>${reqs}</ServiceRequest></Siri>`;
};

// Extraction du premier contenu d'une balise dans un fragment XML.
const tag = (xml, name) => {
    const m = xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`));
    return m ? m[1].trim() : null;
};

const parseSiri = (xml) => {
    const visits = [];
    // Découpe en blocs MonitoredStopVisit (structure fixe d'okina)
    const blocks = xml.split('<MonitoredStopVisit>').slice(1);
    for (const raw of blocks) {
        const block = raw.split('</MonitoredStopVisit>')[0];
        const monRef = tag(block, 'MonitoringRef');
        const stop   = QUAY_TO_STOP[monRef];
        if (!stop) continue;

        const lineRef = tag(block, 'LineRef') || '';
        const lineMatch = lineRef.match(/:Line:([^:]+):/);
        const line = lineMatch ? lineMatch[1] : '';
        if (!(NEEDED_LINES[stop] || []).includes(line)) continue;

        const expected = tag(block, 'ExpectedDepartureTime')
            || tag(block, 'AimedDepartureTime')
            || tag(block, 'ExpectedArrivalTime')
            || tag(block, 'AimedArrivalTime');
        const aimed = tag(block, 'AimedDepartureTime') || tag(block, 'AimedArrivalTime');
        if (!expected) continue;

        visits.push({
            stop,
            line,
            mode: tag(block, 'VehicleMode') || '',
            terminus: tag(block, 'DestinationName') || tag(block, 'DestinationDisplay') || '',
            expected,
            aimed,
            atStop: /<VehicleAtStop>true<\/VehicleAtStop>/.test(block),
        });
    }
    // Tri chronologique global (le front re-filtre par arrêt/ligne)
    visits.sort((a, b) => new Date(a.expected) - new Date(b.expected));
    return visits;
};

const fetchFromOkina = async () => {
    const r = await fetch(OKINA_URL, {
        method: 'POST',
        headers: { 'apikey': API_KEY, 'Content-Type': 'application/xml' },
        body: buildSiriRequest(),
    });
    if (!r.ok) throw new Error(`okina HTTP ${r.status}`);
    const xml = await r.text();
    return parseSiri(xml);
};

export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS_HEADERS });
        }

        // Cache edge partagé : 1 appel okina max toutes les 25 s, tous visiteurs confondus
        const cache = caches.default;
        const cacheKey = new Request(new URL('/siri-cache-v1', request.url), request);
        let hit = await cache.match(cacheKey);
        if (hit) {
            const body = await hit.text();
            return new Response(body, { headers: jsonHeaders(true) });
        }

        try {
            const visits = await fetchFromOkina();
            const payload = JSON.stringify({ ts: new Date().toISOString(), visits });
            const resp = new Response(payload, { headers: jsonHeaders(false) });
            // Stocke une copie en cache (TTL via Cache-Control)
            ctx.waitUntil(cache.put(cacheKey, new Response(payload, {
                headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_TTL}` },
            })));
            return resp;
        } catch (e) {
            return new Response(JSON.stringify({ error: String(e), visits: [] }), {
                status: 502, headers: jsonHeaders(false),
            });
        }
    },
};

const jsonHeaders = (cached) => ({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': `public, max-age=${CACHE_TTL}`,
    'X-Cache': cached ? 'HIT' : 'MISS',
    ...CORS_HEADERS,
});
