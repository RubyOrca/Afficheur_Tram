# AGENTS.md — Afficheur Félix Faure (Nantes)

Doc technique d'entrée pour un agent. Voir aussi : `README.md` (usage/déploiement),
`worker/README.md` (proxy Cloudflare), `agents_definition.md` (rôles produit).

## Rôle
Tableau d'affichage temps réel pour un écran mural : prochains passages tram/bus
(arrêt Félix Faure), météo + marées, marché/immobilier, agenda + anniversaires + alertes TAN.
Déployé en statique sur **Cloudflare Pages**.

## Stack & structure
- **Front** : Vite + vanilla JS (`app.js`), `style.css`, `index.html`. Aucun framework.
- **Données transport** : API **SIRI de Naolib** (l'ancienne `open.tan.fr/ewp` a été coupée
  par la TAN en déc. 2025), via un **Cloudflare Worker** proxy (`worker/siri-proxy.js`) qui
  cache 25 s et convertit XML→JSON. Le worker porte aussi `/tides` (clé Stormglass) et
  `/calendar` (URL iCal privée) — **aucun secret dans le bundle publié**.
- **Autres flux** (appelés directement depuis le navigateur) : Open-Meteo (météo),
  Yahoo Finance via `corsproxy.io` + CoinGecko (marché), data.gouv/DVF pré-calculé (immo),
  data.economie.gouv.fr (carburant), data.nantesmetropole (alertes TAN).
- **Config** : `.env` → `VITE_SIRI_PROXY` (URL du worker). Voir `.env.example`.

## Points d'entrée
- Dév : `npm run dev` (Vite, localhost:5173).
- Build : `npm run build` → `dist/` (publié par Cloudflare Pages via GitHub Actions).
- Worker : `cd worker && npx wrangler deploy` ; secrets via `wrangler secret put`.

## Comportement dégradé
Chaque widget gère son erreur indépendamment (carte « -- » / « Flux indisponible »).
Le transport mémorise le **dernier état valide** (`lastGoodStopData`) et l'affiche marqué
« figé HH:MM » (`#last-update.stale`) si un refresh échoue, au lieu de vider le tableau.

## À savoir
- Données immobilières `IMMO_HISTORY` (DVF) : **rafraîchir annuellement** (dans `app.js`).
- Temps de trajet inter-arrêts codés en constantes en tête d'`app.js` (`FFAU_TO_*`).
- Pas de tests automatisés. Vérif = `npm run build` + contrôle visuel.
