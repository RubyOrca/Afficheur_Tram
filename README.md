# Afficheur Tram Nantes - Multi-Agent Development System

Ce projet utilise un système d'agents spécialisés pour concevoir une interface premium de temps réel pour les tramways nantais.

## Système d'Agents

Le développement est orchestré par quatre agents spécialisés :

1.  **L'Architecte** : Définit la structure technique, choisit les API (SIRI/GTFS-RT) et assure la robustesse du code.
2.  **Le Styliste** : Responsable de l'esthétique "Premium". Utilise le Glassmorphism, des palettes HSL harmonieuses et des micro-animations.
3.  **L'Ingénieur Data** : Gère l'intégration avec Naolib (Open Data Nantes Métropole), le polling des données et la gestion du cache.
4.  **L'Agent QA** : Vérifie la réactivité, l'accessibilité (A11y) et la gestion des erreurs (ex: perte de connexion).

## Technologies
- HTML5 Sémantique
- CSS & Vanilla JS (vibrant & performance)
- API Naolib (TAN) Open Data

## Lancement
- Développement : `npm install` puis `npm run dev` (Vite).
- Build statique (GitHub Pages) : `npm run build` → dossier `dist/`.

## Données temps réel (tram / bus)

L'ancienne API `open.tan.fr/ewp/tempsattente.json` a été **coupée par la TAN (déc. 2025)**
et renvoie désormais des listes vides. Le remplacement officiel est le service **SIRI** de
Naolib (plateforme `api.okina.fr`), qui exige une authentification par en-tête et **ne
supporte pas le CORS** : il ne peut donc pas être appelé directement depuis le navigateur.

Un petit **proxy Cloudflare Worker** fait l'intermédiaire (requête SIRI groupée, cache 25 s,
conversion XML→JSON, CORS). Voir [`worker/README.md`](./worker/README.md) pour le déploiement,
puis renseigner l'URL du worker dans la variable d'env `VITE_SIRI_PROXY`.

Bonus : SIRI fournit l'horaire *prévu* vs *théorique* → l'afficheur montre désormais la
**ponctualité en temps réel** (pastille verte à l'heure, `+Nʹ` en retard, `−Nʹ` en avance).
