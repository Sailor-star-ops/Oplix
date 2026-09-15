import { supabase } from "./supabase";

/* ─── Remplace src/lib/anilist.js ────────────────────────────────────
   Le catalogue vient maintenant de nos propres tables Supabase
   (catalog_anime / catalog_manga), alimentées par scripts/sync-*.mjs
   depuis anime-offline-database + API MAL + Wikidata — plus d'appel
   direct à AniList (refusé pour un tracker concurrent).

   Les fonctions ci-dessous renvoient des objets à la même forme
   imbriquée que l'ancien schéma AniList (title.romaji, coverImage.large,
   etc.) pour limiter la casse dans les composants qui consomment déjà
   cette forme (Modal.jsx notamment). Certains champs n'ont pas de
   source propre (personnages, staff, trailer, recommandations, liens
   externes, épisodes en streaming) et restent vides/null — les
   composants doivent afficher ces sections seulement si présentes.
──────────────────────────────────────────────────────────────────── */

const TABLE = { ANIME: "catalog_anime", MANGA: "catalog_manga" };

const WEEKDAYS = {
  Sundays: 0,
  Mondays: 1,
  Tuesdays: 2,
  Wednesdays: 3,
  Thursdays: 4,
  Fridays: 5,
  Saturdays: 6,
};

/* Approximation du prochain épisode : MAL ne donne qu'un créneau hebdo
   récurrent (jour + heure), pas un countdown exact épisode par épisode
   comme le nextAiringEpisode d'AniList. Le numéro d'épisode est estimé
   à partir de la date de début, pas garanti exact. */
function computeNextAiring(row) {
  if (row.status !== "RELEASING" || !row.broadcast_day) return null;
  const targetDow = WEEKDAYS[row.broadcast_day];
  if (targetDow === undefined) return null;

  const [h, m] = (row.broadcast_time || "00:00").split(":").map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(h || 0, m || 0, 0, 0);
  let diff = (targetDow - next.getUTCDay() + 7) % 7;
  if (diff === 0 && next <= now) diff = 7;
  next.setUTCDate(next.getUTCDate() + diff);

  const airingAt = Math.floor(next.getTime() / 1000);
  let episode = null;
  if (row.start_date && row.episodes) {
    const start = new Date(row.start_date);
    const weeksElapsed = Math.floor((next - start) / (7 * 24 * 3600 * 1000));
    episode = Math.min(Math.max(weeksElapsed + 1, 1), row.episodes);
  }
  return { airingAt, timeUntilAiring: airingAt - Math.floor(Date.now() / 1000), episode };
}

function splitDate(dateStr) {
  if (!dateStr) return { year: null, month: null, day: null };
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  return { year: y || null, month: m || null, day: d || null };
}

/* Les conditions d'utilisation d'Anime News Network demandent un lien vers la
   fiche d'origine sur toute page affichant leurs données — ce lien est donc
   produit systématiquement dès qu'on a un ann_id, et affiché par Modal.jsx. */
export function annUrl(row) {
  if (!row?.ann_id) return null;
  const kind = row._kind === "MANGA" ? "manga" : "anime";
  return `https://www.animenewsnetwork.com/encyclopedia/${kind}.php?id=${row.ann_id}`;
}

/* ANN fournit des noms, pas des portraits : les composants doivent afficher
   la fiche sans image plutôt que de laisser une vignette cassée. */
function toStaffEdges(staff = []) {
  return staff.map((s, i) => ({
    id: `${s.name}-${i}`,
    role: s.task,
    node: { id: s.name, name: { full: s.name }, image: { medium: null, large: null } },
  }));
}

function toCharacterEdges(characters = []) {
  return characters.map((c, i) => ({
    id: `${c.name}-${i}`,
    // ANN ne distingue pas rôle principal et secondaire : on n'invente pas.
    role: null,
    node: { id: c.name, name: { full: c.name }, image: { large: null, medium: null } },
    voiceActors: (c.actors || []).map((a) => ({
      id: a.name,
      name: { full: a.name },
      language: a.lang,
      languageV2: a.lang,
      image: { medium: null, large: null },
    })),
  }));
}

function toMediaShape(row, mediaType) {
  const isAnime = mediaType === "ANIME";
  return {
    id: row.id,
    idMal: row.mal_id,
    title: {
      romaji: row.title_romaji,
      english: row.title_english,
      native: row.title_native,
      userPreferred: row.title_english || row.title_romaji,
    },
    type: mediaType,
    format: isAnime ? row.type : "MANGA", // pas de granularité NOVEL/ONE_SHOT côté manga pour l'instant
    status: row.status,
    description: row.synopsis || null,
    startDate: splitDate(row.start_date),
    endDate: splitDate(row.end_date),
    season: row.season || null,
    seasonYear: row.season_year || null,
    episodes: isAnime ? row.episodes : null,
    duration: isAnime ? row.duration_minutes : null,
    chapters: isAnime ? null : row.chapters ?? null,
    volumes: isAnime ? null : row.volumes ?? null,
    countryOfOrigin: row.country_of_origin || null,
    source: row.source_type || null,
    coverImage: {
      extraLarge: row.cover_url,
      large: row.cover_url,
      medium: row.thumbnail_url || row.cover_url,
      color: null,
    },
    bannerImage: null, // généré côté UI depuis coverImage (voir src/lib/banner.js)
    genres: row.genres || [],
    synonyms: row.synonyms || [],
    tags: (row.tags || []).map((name) => ({ name, rank: null, category: null, isMediaSpoiler: false })),
    averageScore: row.score ? Math.round(row.score * 10) : null,
    meanScore: row.score ? Math.round(row.score * 10) : null,
    // Sémantique AniList : `popularity` = nombre d'utilisateurs suivant l'œuvre.
    // Le rang MyAnimeList est exposé à part, car c'est une autre grandeur —
    // les confondre inversait tous les classements de l'app.
    popularity: row.members ?? null,
    popularityRank: row.popularity ?? null,
    favourites: 0,
    trending: row.trending_score ?? 0,
    isAdult: row.nsfw_level === "black",
    nextAiringEpisode: isAnime ? computeNextAiring(row) : null,
    trailer: null,
    // Pas de "studio" côté manga (pas de source) — on réutilise ce même
    // champ pour l'auteur (Modal.jsx adapte le titre de section selon le type).
    studios: {
      nodes: (isAnime ? row.studios || [] : row.authors || []).map((name) => ({
        id: name,
        name,
        isAnimationStudio: isAnime,
      })),
    },
    externalLinks: (row.external_links || []).map((l, i) => ({
      id: i,
      site: l.label || l.url,
      url: l.url,
      language: l.lang || null,
    })),
    streamingEpisodes: [],
    recommendations: { nodes: [] },
    relations: { edges: [] }, // rempli juste après par attachRawRelationIds/hydrateRelations
    characters: { edges: toCharacterEdges(row.characters) },
    staff: { edges: toStaffEdges(row.staff) },
    rankings: row.rank_overall ? [{ rank: row.rank_overall, type: "RATED", allTime: true, context: "toutes périodes" }] : [],
    siteUrl: annUrl({ ...row, _kind: mediaType }),
    // Titres alternatifs par langue (ANN) — { EN: [...], FR: [...], JA: [...] }
    titlesByLang: row.titles || {},
    openingThemes: row.opening_themes || [],
    endingThemes: row.ending_themes || [],
    copyrightNotice: row.copyright_notice || null,
    isLicensed: row.is_licensed ?? null,
    _mediaType: mediaType,
    // Champs internes (pas dans le schéma AniList d'origine) exposés pour
    // Calendar.jsx, qui a besoin de recalculer une occurrence de diffusion
    // pour une semaine arbitraire (pas seulement "maintenant").
    _broadcastDay: row.broadcast_day || null,
    _broadcastTime: row.broadcast_time || null,
    _startDateRaw: row.start_date || null,
  };
}

/* Occurrence de diffusion hebdo à partir d'une date de référence donnée
   (pas seulement "maintenant" comme nextAiringEpisode) — utilisé par
   Calendar.jsx pour peupler une semaine choisie. Même approximation
   assumée : créneau hebdo MAL, pas un calendrier épisode par épisode. */
export function computeAiringOccurrence(media, referenceDate) {
  if (!media._broadcastDay) return null;
  const targetDow = WEEKDAYS[media._broadcastDay];
  if (targetDow === undefined) return null;

  const [h, m] = (media._broadcastTime || "00:00").split(":").map(Number);
  const d = new Date(referenceDate);
  d.setUTCHours(h || 0, m || 0, 0, 0);
  let diff = (targetDow - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + diff);
  if (d < referenceDate) d.setUTCDate(d.getUTCDate() + 7);

  const airingAt = Math.floor(d.getTime() / 1000);
  let episode = null;
  if (media._startDateRaw && media.episodes) {
    const start = new Date(media._startDateRaw);
    const weeksElapsed = Math.floor((d - start) / (7 * 24 * 3600 * 1000));
    episode = Math.min(Math.max(weeksElapsed + 1, 1), media.episodes);
  }
  return { airingAt, episode };
}

/* Hydrate relations.edges[].node avec un mini-objet (titre/cover/format/statut)
   pour l'onglet "œuvres liées" du Modal — une requête groupée en plus,
   sur les IDs relation déjà stockés (pas d'appel externe). */
async function hydrateRelations(mediaList) {
  const idsToFetch = [];
  for (const m of mediaList) {
    for (const edge of m.relations.edges) {
      if (!edge.node) idsToFetch.push(edge);
    }
  }
  if (idsToFetch.length === 0) return mediaList;

  const allIds = [...new Set(idsToFetch.map((e) => e._rawId).filter(Boolean))];
  if (allIds.length === 0) return mediaList;

  const { data } = await supabase
    .from("catalog_anime")
    .select("id, title_romaji, title_english, type, cover_url, status, episodes")
    .in("id", allIds);
  const byId = new Map((data || []).map((r) => [r.id, r]));

  for (const edge of idsToFetch) {
    const r = byId.get(edge._rawId);
    if (r) {
      edge.node = {
        id: r.id,
        title: { romaji: r.title_romaji, english: r.title_english },
        type: "ANIME",
        format: r.type,
        coverImage: { large: r.cover_url },
        status: r.status,
        episodes: r.episodes,
      };
    }
  }
  return mediaList;
}

function attachRawRelationIds(media, row) {
  media.relations.edges = (row.relations || []).map((r) => ({
    relationType: r.relation_type,
    node: null,
    _rawId: r.id,
  }));
  return media;
}

async function mapRows(rows, mediaType) {
  const media = rows.map((row) => attachRawRelationIds(toMediaShape(row, mediaType), row));
  await hydrateRelations(media);
  return media;
}

/* ─── Fetch par IDs (watchlist, favoris, "en cours de visionnage") ───
   Les IDs peuvent mélanger anime et manga (AniList utilisait un espace
   d'ID unifié) — on interroge les deux tables et on fusionne. */
export async function fetchAllByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const [animeRes, mangaRes] = await Promise.all([
    supabase.from("catalog_anime").select("*").in("id", ids),
    supabase.from("catalog_manga").select("*").in("id", ids),
  ]);
  const [animeMedia, mangaMedia] = await Promise.all([
    mapRows(animeRes.data || [], "ANIME"),
    mapRows(mangaRes.data || [], "MANGA"),
  ]);
  return [...animeMedia, ...mangaMedia];
}

/* ─── Ordre de popularité ────────────────────────────────────────────
   ATTENTION au piège : `popularity` est le RANG MyAnimeList (1 = le plus
   populaire), pas un nombre d'utilisateurs. Le trier en décroissant
   remontait donc les fiches les plus obscures du catalogue — c'était la
   cause du classement absurde en page d'accueil.

   Ordre correct, en cascade :
     1. `members` décroissant — le vrai volume d'utilisateurs (rempli par
        l'enrichissement MyAnimeList) ;
     2. à défaut, `popularity` CROISSANT — le rang, meilleur en premier.
   Les fiches sans aucune des deux finissent naturellement en fin de liste. */
function orderByPopularity(q) {
  return q
    .order("members", { ascending: false, nullsFirst: false })
    .order("popularity", { ascending: true, nullsFirst: false });
}

export async function fetchTrending({ page = 1, perPage = 50 } = {}) {
  const { data, error } = await orderByPopularity(
    supabase
      .from("catalog_anime")
      .select("*")
      // trending_score traduit une VARIATION de popularité entre deux
      // synchronisations (voir scripts/compute-trending.mjs) : c'est ce qui
      // fait qu'une tendance bouge au lieu d'être un palmarès figé.
      .order("trending_score", { ascending: false, nullsFirst: false }),
  ).range((page - 1) * perPage, page * perPage - 1);
  if (error) throw error;
  return mapRows(data || [], "ANIME");
}

export async function fetchSeasonal({ season, year, page = 1, perPage = 50 } = {}) {
  const { data, error } = await orderByPopularity(
    supabase.from("catalog_anime").select("*").eq("season", season).eq("season_year", year),
  ).range((page - 1) * perPage, page * perPage - 1);
  if (error) throw error;
  return mapRows(data || [], "ANIME");
}

/* Chaque tri est une CASCADE de colonnes, appliquées dans l'ordre. Voir
   orderByPopularity ci-dessus pour le piège du rang : `popularity` se trie en
   croissant, jamais en décroissant. */
const SORT_MAP = {
  POPULARITY_DESC: [["members", false], ["popularity", true]],
  TRENDING_DESC: [["trending_score", false], ["members", false], ["popularity", true]],
  SCORE_DESC: [["score", false], ["members", false]],
  FAVOURITES_DESC: [["members", false], ["popularity", true]],
  START_DATE_DESC: [["start_date", false]],
  START_DATE: [["start_date", true]],
  TITLE_ROMAJI: [["title_romaji", true]],
  SEARCH_MATCH: [["members", false], ["popularity", true]],
};

/* Remplace Q_SEARCH — recherche multi-critères utilisée par Explorer
   (filtres complets), Home (genre dominant), Collection et Calendar
   (recherche texte simple). */
export async function searchMedia({
  search,
  genre_in,
  format_in,
  type = "ANIME",
  status,
  season,
  seasonYear,
  year,
  sort = ["POPULARITY_DESC"],
  page = 1,
  perPage = 20,
  isAdult = false,
} = {}) {
  const table = TABLE[type] || TABLE.ANIME;
  let q = supabase.from(table).select("*", { count: "exact" });

  if (search) {
    const safe = search.replace(/[,()%]/g, " ").trim();
    if (safe) q = q.or(`title_romaji.ilike.%${safe}%,title_english.ilike.%${safe}%,title_native.ilike.%${safe}%`);
  }
  if (genre_in?.length) q = q.overlaps("genres", genre_in);
  if (type === "ANIME" && format_in?.length) q = q.in("type", format_in);
  // Pas de colonne format granulaire côté manga pour l'instant : format_in y est un no-op documenté.
  if (status) q = q.eq("status", status);
  if (season) q = q.eq("season", season);
  if (seasonYear) q = q.eq("season_year", seasonYear);
  if (year) q = q.gte("start_date", `${year}-01-01`).lte("start_date", `${year}-12-31`);
  if (type === "ANIME" && isAdult === false) q = q.or("nsfw_level.is.null,nsfw_level.neq.black");

  // Depuis la migration v3, catalog_manga porte les mêmes colonnes de
  // statistiques que catalog_anime : plus besoin de restreindre le tri par type.
  const orders = SORT_MAP[sort?.[0]] || SORT_MAP.POPULARITY_DESC;
  for (const [col, asc] of orders) q = q.order(col, { ascending: asc, nullsFirst: false });
  q = q.range((page - 1) * perPage, page * perPage - 1);

  const { data, error, count } = await q;
  if (error) throw error;
  const media = await mapRows(data || [], type);
  return { media, pageInfo: { total: count || 0, currentPage: page, hasNextPage: page * perPage < (count || 0) } };
}

/* ─── Calendrier de diffusion (remplace Q_WEEK local de Calendar.jsx) ─
   Pas de calendrier épisode-par-épisode exact disponible sans AniList :
   on renvoie les animes en cours de diffusion avec leur créneau hebdo
   approximatif, filtré côté composant sur la semaine affichée. */
export async function fetchAiringAnime() {
  const { data, error } = await supabase
    .from("catalog_anime")
    .select("*")
    .eq("status", "RELEASING")
    .not("broadcast_day", "is", null);
  if (error) throw error;
  return mapRows(data || [], "ANIME");
}

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

export function currentAnilistYear() {
  return new Date().getFullYear();
}

/* Le champ streamingEpisodes n'existe plus (pas de source) — buildEpisodeList
   retombe naturellement sur la plage 1→total sans titres/vignettes. */
function parseEpisodeNumber(title) {
  if (!title) return null;
  const m =
    title.match(/(?:episode|épisode|ep\.?|#)\s*(\d{1,4})/i) || title.match(/^(\d{1,4})[\s.:-]/);
  return m ? parseInt(m[1], 10) : null;
}

export function buildEpisodeList(anime) {
  const total = anime.episodes || 0;
  const raw = anime.streamingEpisodes || [];

  if (total > 0) {
    const byNum = {};
    raw.forEach((ep) => {
      const n = parseEpisodeNumber(ep.title);
      if (n && n >= 1 && n <= total) byNum[n] = ep;
    });
    return Array.from({ length: total }, (_, i) => {
      const num = i + 1;
      const ep = byNum[num];
      return { num, title: ep?.title || null, thumbnail: ep?.thumbnail || null, url: ep?.url || null, site: ep?.site || null };
    });
  }
  return raw.map((ep, i) => ({ num: i + 1, title: ep.title, thumbnail: ep.thumbnail, url: ep.url, site: ep.site }));
}

/* ─── Constantes/labels (inchangés) ──────────────────────────────── */

export const GENRES_ANIME = [
  "Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror",
  "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance",
  "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller",
];

export const GENRES_MANGA = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery",
  "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller",
  "Psychological", "Shounen", "Shoujo", "Seinen", "Josei",
];

export const FORMAT_LABELS = {
  TV: "Série TV", TV_SHORT: "Série courte", MOVIE: "Film", SPECIAL: "Spécial",
  OVA: "OVA", ONA: "ONA", MUSIC: "Clip", MANGA: "Manga", NOVEL: "Light Novel", ONE_SHOT: "One-Shot",
};

export const STATUS_LABELS = {
  FINISHED: "Terminé", RELEASING: "En cours", NOT_YET_RELEASED: "À venir",
  CANCELLED: "Annulé", HIATUS: "En pause",
};

export const SEASON_LABELS = { WINTER: "Hiver", SPRING: "Printemps", SUMMER: "Été", FALL: "Automne" };

export const SOURCE_LABELS = {
  ORIGINAL: "Original", MANGA: "Manga", LIGHT_NOVEL: "Light Novel", VISUAL_NOVEL: "Visual Novel",
  VIDEO_GAME: "Jeu vidéo", NOVEL: "Roman", DOUJINSHI: "Doujinshi", ANIME: "Animé",
  WEB_NOVEL: "Web Novel", LIVE_ACTION: "Live Action", GAME: "Jeu", COMIC: "Comic", OTHER: "Autre",
  "4_KOMA_MANGA": "4-koma", CARD_GAME: "Jeu de cartes", MIXED_MEDIA: "Multi-support", PICTURE_BOOK: "Livre illustré",
};

export const ANIME_FORMATS = [
  { value: "TV", label: "Série TV" }, { value: "TV_SHORT", label: "Série courte" },
  { value: "MOVIE", label: "Film" }, { value: "OVA", label: "OVA" }, { value: "ONA", label: "ONA" },
  { value: "SPECIAL", label: "Spécial" }, { value: "MUSIC", label: "Clip musical" },
];

export const MANGA_FORMATS = [
  { value: "MANGA", label: "Manga" }, { value: "NOVEL", label: "Light Novel" }, { value: "ONE_SHOT", label: "One-Shot" },
];

export const STATUS_OPTIONS = [
  { value: "RELEASING", label: "En cours de diffusion" }, { value: "FINISHED", label: "Terminé" },
  { value: "NOT_YET_RELEASED", label: "À venir" }, { value: "HIATUS", label: "En pause" }, { value: "CANCELLED", label: "Annulé" },
];

export const SORT_OPTIONS = [
  { value: "TRENDING_DESC", label: "Tendance" }, { value: "POPULARITY_DESC", label: "Popularité" },
  { value: "SCORE_DESC", label: "Meilleur score" }, { value: "FAVOURITES_DESC", label: "Plus de favoris" },
  { value: "START_DATE_DESC", label: "Sortie la plus récente" }, { value: "START_DATE", label: "Sortie la plus ancienne" },
  { value: "TITLE_ROMAJI", label: "Titre (A → Z)" },
];

export const SEASONS = [
  { value: "WINTER", label: "Hiver" }, { value: "SPRING", label: "Printemps" },
  { value: "SUMMER", label: "Été" }, { value: "FALL", label: "Automne" },
];
