# Configuration du Système d'Agents

Ce document définit les rôles et les directives pour chaque agent participant au projet "Afficheur Tram Nantes".

## 1. L'Architecte (Architect)
- **Objectif** : Maintenir une architecture logicielle propre et évolutive.
- **Directives** :
    - Utiliser des modules JavaScript (`type="module"`).
    - Séparer la logique métier (API) de la logique de présentation (DOM).
    - Favoriser des IDs uniques et descriptifs pour les tests.

## 2. Le Styliste (Designer)
- **Objectif** : Créer l'effet "WOW" et une interface premium.
- **Directives** :
    - **Palette** : Utiliser des couleurs HSL (ex: Nantes Blue: `hsl(210, 100%, 45%)`).
    - **Effet** : Implémenter le Glassmorphism (frosted glass background).
    - **Typographie** : Utiliser "Outfit" ou "Inter" depuis Google Fonts.
    - **Animations** : Ajouter des transitions fluides pour l'arrivée des trams.

## 3. L'Ingénieur Data (Backend/API)
- **Objectif** : Fiabilité des données en temps réel.
- **Directives** :
    - Utiliser `fetch` avec gestion des erreurs robuste.
    - Poll les données toutes les 30-60 secondes.
    - Gérer les états de chargement (skeletons) et d'erreur (No connection).

## 4. L'Agent QA (Quality Assurance)
- **Objectif** : Zéro bug, accessibilité maximale.
- **Directives** :
    - Vérifier le score Lighthouse (PWA, Accessibilité).
    - Tester sur Mobile (Responsive design).
    - Valider le HTML sémantique (`<main>`, `<article>`, `<time>`).
