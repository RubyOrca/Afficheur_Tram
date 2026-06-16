# Proxy temps réel SIRI (Cloudflare Worker)

L'afficheur lit les horaires tram/bus en temps réel via l'API **SIRI de Naolib/okina**.
Cette API exige une authentification par en-tête et **ne supporte pas le CORS** : elle ne
peut donc pas être appelée directement depuis le navigateur. Ce worker fait l'intermédiaire.

## Ce que fait le worker

- Interroge `api.okina.fr` pour tous les quais utiles en **une seule requête SIRI**.
- Met le résultat **en cache 25 s** (le quota okina est de 1 req/30 s).
- Convertit le XML SIRI en **JSON propre** et ajoute les en-têtes **CORS**.

## Déploiement (≈ 5 min, gratuit)

1. Crée un compte sur https://dash.cloudflare.com (offre gratuite suffisante).
2. **Workers & Pages** → **Create** → **Create Worker** → donne un nom (ex. `tan-siri`).
3. **Edit code** → colle le contenu de [`siri-proxy.js`](./siri-proxy.js) → **Deploy**.
4. Note l'URL publique, ex. `https://tan-siri.<ton-sous-domaine>.workers.dev`.

### Option CLI (wrangler)

```bash
npm i -g wrangler
wrangler login
wrangler deploy worker/siri-proxy.js --name tan-siri --compatibility-date 2024-01-01
```

## Brancher l'afficheur sur le worker

Renseigne l'URL du worker dans la variable d'env `VITE_SIRI_PROXY` :

- **Local** — fichier `.env.local` à la racine :
  ```
  VITE_SIRI_PROXY=https://tan-siri.<ton-sous-domaine>.workers.dev
  ```
- **GitHub Pages** — ajoute un *Repository secret* `VITE_SIRI_PROXY` (Settings → Secrets →
  Actions) puis injecte-le dans le build, comme déjà fait pour `VITE_STORMGLASS_KEY`
  (voir le workflow `.github/workflows`).

Sans cette variable, l'afficheur affiche « Flux indisponible » pour les transports
(le reste — météo, marées, finance — continue de fonctionner).

## Test rapide

```bash
curl https://tan-siri.<ton-sous-domaine>.workers.dev | head
# → {"ts":"...","visits":[{"stop":"FFAU","line":"3","mode":"tram","terminus":"Neustrie",...}]}
```
