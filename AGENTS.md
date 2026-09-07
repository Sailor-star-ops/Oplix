# Oplix

Tracker anime/manga (à terme : le meilleur, cible = millions d'utilisateurs). Interface entièrement en français, thème sombre, accent orange `#ff5500`, polices `Space Grotesk` (titres) / `Outfit` (texte). Voir [[project-oplix-vision]] côté mémoire pour l'ambition produit détaillée.

## Stack

- **React 18 + Vite**, pas de TypeScript, pas de framework de routing (navigation par état `tab` dans [src/App.jsx](src/App.jsx), pas d'URLs de pages — sauf `?c=` et `?p=` pour les vues publiques partagées).
- **Supabase** (`src/lib/supabase.js`) : auth, Postgres (table `profiles`, `watchlist`, `friendships`, `collections`/`collection_items`), Storage (bucket `avatars` pour tout ce qui est image uploadée — avatars, bannières).
- **Catalogue interne** (`src/lib/catalog.js`, tables Supabase `catalog_anime`/`catalog_manga`) : source de métadonnées anime/manga possédée par Oplix, alimentée par `scripts/sync-anime.mjs` (anime-offline-database + API MAL v2) et `scripts/sync-manga-wikidata.mjs` (Wikidata), via GitHub Actions (`.github/workflows/sync-catalog.yml`). AniList a explicitement refusé son API à un tracker concurrent — voir JOURNAL.md pour le contexte. Le client lit directement Supabase (clé anon, lecture seule) ; seul le script d'import écrit, via la clé service role (jamais exposée au client). Champs sans source propre trouvée (personnages, staff détaillé, trailer, recommandations, liens externes) : absents, les composants (Modal.jsx) masquent ces sections si vides plutôt que de planter.
- Une seule feuille de style globale : [src/App.css](src/App.css) (~3900 lignes). Pas de CSS modules, pas de Tailwind — classes BEM-ish (`.ph__banner`, `.pfav__cover`, etc.).

## Conventions observées

- Bouton "remonter en haut" ([ScrollToTop.jsx](src/components/ScrollToTop.jsx)) : à poser comme enfant de n'importe quel `.scroll-area` de contenu (pas les états vides/non-connecté). Il retrouve son conteneur scrollable via `closest(".scroll-area")`, pas besoin de ref à faire remonter depuis la page. Anneau SVG qui se remplit avec la progression du scroll (`--accent`, donc violet automatique en mode Social). Déjà branché sur Home/Explorer/Collection/Calendar/Profile/Friends (3 vues)/SocialFeed/Leaderboard — à ajouter systématiquement sur toute nouvelle page listant du contenu scrollable.
- Les pages (`src/pages/*.jsx`) gèrent leurs propres appels Supabase directement (pas de couche service séparée) et reçoivent `user`/`profile`/`setProfile` en props depuis `App.jsx`.
- Commentaires de section en français avec bannières `/* ─── Titre ─── */` — à respecter dans le style existant.
- Le fichier App.css a connu plusieurs refontes successives (sections "COCON", "v3", etc.) qui se **surchargent en cascade** : la même classe peut être définie plusieurs fois plus loin dans le fichier. Toujours vérifier avec Grep si une classe existe déjà avant d'en ajouter une, et regarder à quel endroit du fichier l'ajouter (l'ordre compte).
- Pas de tests, pas de CI configurée à ce jour.

## Thème clair/sombre — design tokens

`App.css` définit des variables CSS dans `:root` (sombre, par défaut) et `:root[data-theme="light"]` (clair). Le switch réel vit dans `App.jsx` (state `theme`, persisté dans `localStorage["oplix-theme"]`, posé comme attribut `data-theme` sur `<html>`) et se déclenche depuis le menu ⚙️ Paramètres (`Topbar.jsx`).

Règles à respecter pour tout nouveau CSS :

- **Jamais de couleur brute** (`#xxxxxx`, `rgba(255,255,255,...)`, `white`, `black`) dans une règle qui vit sur la surface normale de l'app. Utiliser le token du bon rôle : fond → `--bg-app` / `--bg-surface` / `--bg-surface-2` / `--bg-elevated` / `--bg-hover*`, texte → `--text-1` (le plus lumineux) à `--text-7` (le plus discret), bordure/relief → `rgba(var(--overlay-rgb), alpha)`, accent → `--accent` / `--accent-rgb` / `--accent-light`, statuts → `--success` / `--danger` / `--gold` / `--purple` / `--cyan` / `--blue`.
- **Exception : texte/UI posé directement sur une image** (bannière hero, poster de la modale anime, bannière de profil ou de sidebar) — jamais `--text-*` ni `--overlay-rgb`, qui s'inversent avec le thème et rendraient ce texte illisible sur la photo. Utiliser `--text-on-accent` (blanc fixe), `--text-on-light` (sombre fixe, pour texte sur pastille/curseur coloré), `rgba(var(--on-image-rgb), alpha)` ou `--scrim` (dégradé de lisibilité) — ces tokens ne changent jamais entre les deux thèmes. Composants concernés aujourd'hui : `.hero-*` (accueil), `.cal4-hero__*` (calendrier), `.mi__hero*`/`.mi__title*`/`.mi__poster`/`.mi__pill*`/`.mi__genre` (modale anime), `.pp-hero-*`/`.pp-avatar` (profil public), `.ph__content` et ses enfants (bannière du profil), `.vp-unavailable-*` (lecteur), `.sidebar-head--banner .brand`, `.user-card--banner .user-info`.
- Si une vraie nouvelle couleur est nécessaire (nouveau statut, nouvelle nuance d'accent), l'ajouter comme variable nommée dans le bloc `:root` en haut d'`App.css` — jamais en dur dans la règle qui l'utilise.
- Avant d'ajouter un nouveau composant "bannière/hero" (image en fond + texte par-dessus), se poser la question dès le départ : est-ce que ce texte doit s'inverser avec le thème (posé sur la surface de l'app) ou rester fixe (posé sur une image) ? C'est l'oubli le plus fréquent — un remplacement en masse de littéraux par des tokens theme-réactifs a cassé plusieurs bannières la première fois, avant d'être corrigé composant par composant.

## Pièges déjà rencontrés

- Mismatch classe JSX / classe CSS très fréquent (le composant a été réécrit plusieurs fois sans nettoyer le CSS mort, ou l'inverse) — si un style ne s'applique pas, vérifier d'abord que la classe existe réellement dans App.css avant de chercher ailleurs.
- `z-index` négatif sur un enfant d'un conteneur `position:relative` **sans** `z-index` propre : le conteneur n'établit pas de contexte d'empilement, l'enfant s'échappe et peut se retrouver rendu derrière toute la page. Vu sur `.ph__banner`.
- Pas de repo git initialisé sur ce projet — pas de garde-fou par commit, faire particulièrement attention avant toute suppression/écrasement de fichier.
