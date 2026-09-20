# Oplix

Tracker anime/manga (à terme : le meilleur, cible = millions d'utilisateurs). Interface entièrement en français, thème sombre, accent orange `#ff5500`, polices `Space Grotesk` (titres) / `Outfit` (texte). Voir [[project-oplix-vision]] côté mémoire pour l'ambition produit détaillée.

## Stack

- **React 18 + Vite**, pas de TypeScript, pas de framework de routing (navigation par état `tab` dans [src/App.jsx](src/App.jsx), pas d'URLs de pages — sauf `?c=` et `?p=` pour les vues publiques partagées).
- **Supabase** (`src/lib/supabase.js`) : auth, Postgres (table `profiles`, `watchlist`, `friendships`, `collections`/`collection_items`), Storage (bucket `avatars` pour tout ce qui est image uploadée — avatars, bannières).
- **Catalogue interne** (`src/lib/catalog.js`, tables Supabase `catalog_anime`/`catalog_manga`) : source de métadonnées anime/manga possédée par Oplix, alimentée par des scripts lancés via deux workflows GitHub Actions :
  - **`sync-catalog.yml`** (hebdomadaire, lundi 4 h UTC, quelques minutes) — les sources :
    - `scripts/sync-anime.mjs --skeleton` — anime-offline-database (ODbL)
    - `scripts/sync-manga-wikidata.mjs` — Wikidata (CC0)
    - `scripts/sync-ann.mjs` — Anime News Network : titres multilingues, équipe, **casting dont les voix françaises**, liens officiels, thèmes musicaux, et un catalogue manga qui triple de volume
  - **`enrich-catalog.yml`** (quotidien, 2 h UTC) — ce qui est long ou cumulatif :
    - `scripts/enrich-mal.mjs` — API MAL v2, **reprenable** (`mal_synced_at`), mieux classés d'abord, borné à 330 min par passage sous le plafond de 6 h
    - `scripts/compute-trending.mjs` — score de tendance + relevé quotidien dans `catalog_trend_snapshot`

  **Piège de popularité :** la colonne `popularity` est le *rang* MyAnimeList (1 = le plus populaire), pas un volume — elle se trie en **croissant**. Le volume est `members`. Trier `popularity` en décroissant affichait les fiches les plus obscures en page d'accueil.

  Le client lit directement Supabase (clé anon, lecture seule) ; seuls les scripts écrivent, via la clé service role (jamais exposée au client).

  **Contraintes de sources à respecter impérativement** (voir la mémoire `project-oplix-sources-catalogue`) :
  - **AniList est interdit** — refus écrit opposé à Oplix en tant que tracker concurrent. Ni API, ni images. `scripts/purge-anilist-assets.mjs` a retiré les 732 hotlinks restants vers `s4.anilist.co` ; `cleanImageUrl()` dans `sync-anime.mjs` empêche leur retour. Ne jamais réintroduire de dépendance à AniList.
  - **anime-offline-database est archivé depuis le 2026-07-04** : figé à 41 537 entrées, plus jamais mis à jour. La fraîcheur du catalogue repose désormais sur ANN.
  - **L'attribution est contractuelle, pas décorative.** ANN impose d'être cité comme source ET qu'un lien vers sa fiche figure sur toute page affichant ses données (`.mi__sources` dans Modal.jsx) ; la licence ODbL impose la mention de la source sur l'œuvre produite (`.tb__sources` dans Topbar.jsx). Ne jamais retirer ces deux blocs.
  - **Sources écartées, ne pas proposer** : AniDB (CC BY-NC-SA, scraping interdit), MangaDex (publicité interdite), TMDb (accord séparé pour le commercial), Jikan (c'est du MAL scrapé).
  - **Le fair use n'est pas invocable** : doctrine de common law, inexistante en droit français (liste limitative de l'art. L122-5 CPI). Comme Oplix importe lui-même les images, il est *éditeur* et non hébergeur — pas de bouclier de l'art. 6 LCEN.

  Champs restant sans source (calendrier épisode par épisode, vignettes d'épisodes, hashtag officiel) : absents, les composants masquent ces sections si vides plutôt que de planter.

- **Les identifiants du catalogue ne doivent jamais changer.** `catalog_anime.id` / `catalog_manga.id` sont référencés par `watchlist`, `collection_items`, `activity_events`, `episode_logs` et `profiles.favorite_animes` : les rebaser orphelinerait toutes les listes des utilisateurs. Règle appliquée dans `scripts/lib/ids.mjs` : on garde l'ID AniList historique quand il existe, sinon on dérive un ID stable dans une plage réservée (`900000000+` pour MAL/Wikidata, `800000000+` pour ANN).
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
- **Dépôt git : `Sailor-star-ops/Oplix` (privé), branche `master`.** Il a été poussé via une URL contenant un jeton, pas via le remote nommé : `.git/refs/remotes/` n'existe donc pas localement et `master` ne suit aucun remote. **Ne pas en conclure que rien n'a été poussé** (erreur déjà commise une fois). L'état distant se vérifie sur github.com, pas depuis le clone.
- **GitHub Actions exécute le code POUSSÉ, pas le code local.** Tant que les modifications locales ne sont pas poussées, les workflows programmés continuent de faire tourner l'ancienne version — c'est ainsi que, le lundi 2026-09-14, l'ancien `sync-anime.mjs` a réinjecté les 732 jaquettes hébergées par AniList qui venaient d'être purgées. Toute correction touchant un script lancé par un workflow doit être poussée avant le prochain cron.
- **Une requête Supabase non paginée s'arrête à 1 000 lignes, sans erreur ni avertissement.** C'est ainsi que la table de correspondance MAL -> catalogue d'`enrich-mal.mjs` n'a couvert que 1 000 des 30 561 anime : 29 668 fiches ont été écrites avec une liste d'œuvres liées vide, et rien ne les reprenait. Tout `select` censé ramener « tout » doit passer par une boucle `range()` triée sur l'id.
- **Chaque script n'a le droit d'écrire que les colonnes dont il est la source.** `sync-anime.mjs --skeleton` renvoyait chaque lundi `title_english`/`title_native` à `null` et réécrasait synonymes, score, statut, jaquette et relations avec les valeurs du dataset figé — effaçant l'enrichissement MyAnimeList, que rien ne refaisait ensuite (la fiche compte comme déjà synchronisée). La liste des colonnes du dataset est explicite dans `DATASET_OWNED` ; les fiches déjà en base ne reçoivent que celles-là.
- **`nsfw_level` ne vaut jamais `black`** : vérifié sur les 30 561 fiches enrichies, MyAnimeList ne renseigne que `white` et `gray`. Le filtre « contenu adulte » doit s'appuyer sur `age_rating = 'rx'` et sur les genres/thèmes explicites (`excludeAdult()` dans `catalog.js`), jamais sur `nsfw_level` seul.
- **Les genres arrivent dans trois casses différentes** (MAL et le dataset en capitales, ANN en minuscules). Tout nouveau script qui écrit `genres` doit passer par `normalizeGenres()` (`scripts/lib/genres.mjs`), sinon les fiches concernées deviennent invisibles aux filtres par genre, qui comparent des chaînes exactes.
- **Toute requête Supabase paginée (`.range()`) doit trier sur une clé unique** (`.order("id")`, ou la clé composite d'une table sans id). Sans tri stable, Postgres renvoie des lignes en double d'une page à l'autre, et un upsert contenant deux fois le même id échoue en entier. `upsertInChunks` déduplique par sécurité, mais ce n'est qu'un filet.
- Trois copies du dossier du projet existent à côté de celle-ci (`oplix`, `oplix - Copie`, `oplix - Copie - Copie - Copie`) ; seule `oplix - Copie - Copie` contient les scripts et le `.env`. C'est la bonne.
