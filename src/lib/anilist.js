const ANILIST_URL = "https://graphql.anilist.co";

export async function anilistFetch(query, variables = {}) {
  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error("AniList API error: " + res.status);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

/* ─── Fragment commun Media ─────────────────────────────────────────
   Utilisé dans toutes les queries pour éviter la duplication.
   Contient TOUS les champs exploitables.
──────────────────────────────────────────────────────────────────── */
const MEDIA_FIELDS = `
  id idMal
  title { romaji english native userPreferred }
  type format status
  description
  startDate { year month day }
  endDate   { year month day }
  season seasonYear
  episodes duration
  chapters volumes
  countryOfOrigin source
  coverImage { extraLarge large medium color }
  bannerImage
  genres
  synonyms
  tags { name rank category isMediaSpoiler }
  averageScore meanScore popularity favourites trending
  isAdult
  nextAiringEpisode { airingAt timeUntilAiring episode }
  trailer { id site thumbnail }
  studios(isMain: true) { nodes { id name isAnimationStudio } }
  externalLinks { url site type color icon }
  streamingEpisodes { title thumbnail url site }
  recommendations(sort: RATING_DESC, perPage: 6) {
    nodes { rating mediaRecommendation {
      id title { romaji english }
      coverImage { large color }
      averageScore format episodes
    }}
  }
  relations { edges {
    relationType
    node { id title { romaji english } type format coverImage { large } status episodes }
  }}
  characters(sort: ROLE, perPage: 6) { edges {
    role
    node { id name { full native } image { large } }
    voiceActors(language: JAPANESE) { id name { full } image { medium } }
  }}
  staff(sort: RELEVANCE, perPage: 6) { edges {
    role
    node { id name { full } image { medium } }
  }}
  siteUrl
`;

/* ─── Trending ──────────────────────────────────────────────────── */
export const Q_TRENDING = `
query($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage }
    media(sort: TRENDING_DESC, type: ANIME, isAdult: false) { ${MEDIA_FIELDS} }
  }
}`;

/* ─── Populaire (homepage manga) ───────────────────────────────── */
export const Q_TRENDING_MANGA = `
query($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage }
    media(sort: TRENDING_DESC, type: MANGA, isAdult: false) { ${MEDIA_FIELDS} }
  }
}`;

/* ─── Recherche unifiée anime + manga, multi-critères ───────────── */
export const Q_SEARCH = `
query(
  $search: String
  $genre_in: [String]
  $format_in: [MediaFormat]
  $type: MediaType
  $status: MediaStatus
  $season: MediaSeason
  $seasonYear: Int
  $year: String
  $sort: [MediaSort]
  $page: Int
  $perPage: Int
  $isAdult: Boolean
) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage }
    media(
      search: $search
      genre_in: $genre_in
      format_in: $format_in
      type: $type
      status: $status
      season: $season
      seasonYear: $seasonYear
      startDate_like: $year
      sort: $sort
      isAdult: $isAdult
    ) { ${MEDIA_FIELDS} }
  }
}`;

/* ─── Top animés ────────────────────────────────────────────────── */
export const Q_TOP = `
query($page: Int, $perPage: Int, $type: MediaType) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage }
    media(sort: SCORE_DESC, type: $type, isAdult: false) { ${MEDIA_FIELDS} }
  }
}`;

/* ─── Saisonnier ────────────────────────────────────────────────── */
export const Q_SEASONAL = `
query($season: MediaSeason, $year: Int, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage }
    media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ${MEDIA_FIELDS} }
  }
}`;

/* ─── Par IDs (watchlist) ────────────────────────────────────────── */
export const Q_BY_IDS = `
query($ids: [Int], $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(id_in: $ids) { ${MEDIA_FIELDS} }
  }
}`;

/* ─── Calendrier de diffusion ───────────────────────────────────── */
export const Q_AIRING = `
query($page: Int) {
  Page(page: $page, perPage: 50) {
    airingSchedules(notYetAired: true, sort: TIME) {
      id episode airingAt timeUntilAiring
      media {
        id title { romaji english native }
        coverImage { extraLarge large medium color }
        bannerImage status episodes format duration
        popularity seasonYear season genres averageScore
        nextAiringEpisode { airingAt timeUntilAiring episode }
      }
    }
  }
}`;

/* ─── Media unique par ID ────────────────────────────────────────── */
export const Q_MEDIA_BY_ID = `
query($id: Int!) {
  Media(id: $id) { ${MEDIA_FIELDS} }
}`;

/* ─── Recommandations personnalisées par genres ──────────────────── */
export const Q_RECOMMENDATIONS = `
query($genres: [String], $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(genre_in: $genres, sort: POPULARITY_DESC, type: ANIME, isAdult: false) { ${MEDIA_FIELDS} }
  }
}`;

/* ─── Helpers ────────────────────────────────────────────────────── */

export function getSeason() {
  const m = new Date().getMonth();
  const y = new Date().getFullYear();
  if (m <= 2) return { season: "WINTER", year: y };
  if (m <= 5) return { season: "SPRING", year: y };
  if (m <= 8) return { season: "SUMMER", year: y };
  return { season: "FALL", year: y };
}

export function stripHtml(html, maxLen = 500) {
  if (!html) return "";
  const d = document.createElement("div");
  d.innerHTML = html;
  const text = (d.textContent || d.innerText || "").replace(/\n+/g, " ").trim();
  return text.length > maxLen ? text.substring(0, maxLen) + "…" : text;
}

export function formatDuration(minutes) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${m > 0 ? m + "m" : ""}` : `${m}m`;
}

export function calcTotalHours(watchlist) {
  return Math.round(
    watchlist.reduce((acc, item) => {
      const dur = item._anime?.duration || 24;
      const seen = item.progress || 0;
      return acc + (dur * seen) / 60;
    }, 0),
  );
}

export function calcStats(watchlist) {
  return {
    watching: watchlist.filter((w) => w.status === "watching").length,
    completed: watchlist.filter((w) => w.status === "completed").length,
    plan_to_watch: watchlist.filter((w) => w.status === "plan_to_watch").length,
    dropped: watchlist.filter((w) => w.status === "dropped").length,
    episodes: watchlist.reduce((acc, w) => acc + (w.progress || 0), 0),
    hours: calcTotalHours(watchlist),
    total: watchlist.length,
  };
}

/* Charge TOUTES les pages d'une watchlist (>50 entrées) */
export async function fetchAllByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const pages = Math.ceil(ids.length / 50);
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      anilistFetch(Q_BY_IDS, {
        ids: ids.slice(i * 50, (i + 1) * 50),
        page: 1,
      }).then((d) => d.Page.media),
    ),
  );
  return results.flat();
}

export const GENRES_ANIME = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Horror",
  "Mahou Shoujo",
  "Mecha",
  "Music",
  "Mystery",
  "Psychological",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
];

export const GENRES_MANGA = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
  "Psychological",
  "Shounen",
  "Shoujo",
  "Seinen",
  "Josei",
];

export const FORMAT_LABELS = {
  TV: "Série TV",
  TV_SHORT: "Série courte",
  MOVIE: "Film",
  SPECIAL: "Spécial",
  OVA: "OVA",
  ONA: "ONA",
  MUSIC: "Clip",
  MANGA: "Manga",
  NOVEL: "Light Novel",
  ONE_SHOT: "One-Shot",
};

export const STATUS_LABELS = {
  FINISHED: "Terminé",
  RELEASING: "En cours",
  NOT_YET_RELEASED: "À venir",
  CANCELLED: "Annulé",
  HIATUS: "En pause",
};

export const SEASON_LABELS = {
  WINTER: "Hiver",
  SPRING: "Printemps",
  SUMMER: "Été",
  FALL: "Automne",
};

export const SOURCE_LABELS = {
  ORIGINAL: "Original",
  MANGA: "Manga",
  LIGHT_NOVEL: "Light Novel",
  VISUAL_NOVEL: "Visual Novel",
  VIDEO_GAME: "Jeu vidéo",
  NOVEL: "Roman",
  DOUJINSHI: "Doujinshi",
  ANIME: "Animé",
  WEB_NOVEL: "Web Novel",
  LIVE_ACTION: "Live Action",
  GAME: "Jeu",
  COMIC: "Comic",
  OTHER: "Autre",
};

/* ─── Filtre Explorer avancé (formats, tri, statuts) ────────────────
   Utilisé par Explorer.jsx pour construire le panneau de filtre complet
   (ce qui remplace l'ancienne page Top : le tri "Score" en fait office).
──────────────────────────────────────────────────────────────────── */

export const ANIME_FORMATS = [
  { value: "TV", label: "Série TV" },
  { value: "TV_SHORT", label: "Série courte" },
  { value: "MOVIE", label: "Film" },
  { value: "OVA", label: "OVA" },
  { value: "ONA", label: "ONA" },
  { value: "SPECIAL", label: "Spécial" },
  { value: "MUSIC", label: "Clip musical" },
];

export const MANGA_FORMATS = [
  { value: "MANGA", label: "Manga" },
  { value: "NOVEL", label: "Light Novel" },
  { value: "ONE_SHOT", label: "One-Shot" },
];

export const STATUS_OPTIONS = [
  { value: "RELEASING", label: "En cours de diffusion" },
  { value: "FINISHED", label: "Terminé" },
  { value: "NOT_YET_RELEASED", label: "À venir" },
  { value: "HIATUS", label: "En pause" },
  { value: "CANCELLED", label: "Annulé" },
];

export const SORT_OPTIONS = [
  { value: "TRENDING_DESC", label: "Tendance" },
  { value: "POPULARITY_DESC", label: "Popularité" },
  { value: "SCORE_DESC", label: "Meilleur score" },
  { value: "FAVOURITES_DESC", label: "Plus de favoris" },
  { value: "START_DATE_DESC", label: "Sortie la plus récente" },
  { value: "START_DATE", label: "Sortie la plus ancienne" },
  { value: "TITLE_ROMAJI", label: "Titre (A → Z)" },
];

export const SEASONS = [
  { value: "WINTER", label: "Hiver" },
  { value: "SPRING", label: "Printemps" },
  { value: "SUMMER", label: "Été" },
  { value: "FALL", label: "Automne" },
];

export function currentAnilistYear() {
  return new Date().getFullYear();
}

/* ─── Construction fiable de la liste d'épisodes ─────────────────────
   Le champ streamingEpisodes d'AniList ne donne PAS de numéro d'épisode
   propre — juste un titre texte, dans un ordre pas toujours fiable
   (ex: MHA peut renvoyer la numérotation globale de la franchise,
   à l'envers, incomplète). On reconstruit donc la vraie plage 1→total
   à partir de anime.episodes, et on ne rattache un titre/vignette que
   si on arrive à extraire un numéro cohérent avec cette plage.
──────────────────────────────────────────────────────────────────── */
function parseEpisodeNumber(title) {
  if (!title) return null;
  const m =
    title.match(/(?:episode|épisode|ep\.?|#)\s*(\d{1,4})/i) ||
    title.match(/^(\d{1,4})[\s.:\-]/);
  return m ? parseInt(m[1], 10) : null;
}

export function buildEpisodeList(anime) {
  const total = anime.episodes || 0;
  const raw = anime.streamingEpisodes || [];

  if (total > 0) {
    // On indexe les épisodes streamés par numéro détecté dans leur titre.
    const byNum = {};
    raw.forEach((ep) => {
      const n = parseEpisodeNumber(ep.title);
      if (n && n >= 1 && n <= total) byNum[n] = ep;
    });
    // Si rien n'a pu être rattaché de façon fiable (aucun numéro cohérent
    // avec la plage 1→total), on ne montre aucune vignette plutôt que
    // d'en montrer de fausses — mais la plage 1→total reste correcte.
    return Array.from({ length: total }, (_, i) => {
      const num = i + 1;
      const ep = byNum[num];
      return {
        num,
        title: ep?.title || null,
        thumbnail: ep?.thumbnail || null,
        url: ep?.url || null,
        site: ep?.site || null,
      };
    });
  }

  // Pas de total connu (rare) : on retombe sur l'ordre brut, sans mieux.
  return raw.map((ep, i) => ({
    num: i + 1,
    title: ep.title,
    thumbnail: ep.thumbnail,
    url: ep.url,
    site: ep.site,
  }));
}
