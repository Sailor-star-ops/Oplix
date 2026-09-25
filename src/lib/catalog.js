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

/* Colonnes suffisantes pour une liste (carte, résultat de recherche, hero).
   `select=*` ramenait aussi les gros champs JSON — personnages, équipe,
   titres multilingues, liens, génériques, relations — soit plusieurs
   kilo-octets par ligne qui ne servent qu'à la fiche détaillée. Mesuré le
   2026-09-20 sur une recherche triée : 3,07 s avec `*`, 0,33 s sans. Au-delà
   de la lenteur, la requête dépassait le délai maximal et revenait en erreur
   500 dans le navigateur. La fiche détaillée, elle, recharge la ligne
   complète (voir handleOpenModal dans App.jsx). */

/* Colonnes venues d'Anime News Network, seule source du catalogue qui
   n'impose aucune autorisation écrite pour un usage commercial. Elles
   doublent volontairement des colonnes que MyAnimeList alimente aussi
   (jaquette, note), pour que l'app puisse s'en passer sans rien perdre le
   jour où MyAnimeList coupe l'accès — voir supabase_catalog_v4.sql.
   `ann_synopsis` reste hors de cette liste : c'est le seul champ lourd des
   six, et seule la fiche détaillée (qui recharge la ligne entière) s'en
   sert vraiment. */
const ANN_COLS = "ann_cover_url, ann_rating, ann_rating_votes, ann_objectionable";

const LIST_COLS =
  "id, mal_id, ann_id, title_romaji, title_english, title_native, synonyms, type, status, " +
  "episodes, duration_minutes, season, season_year, start_date, end_date, studios, genres, tags, " +
  "cover_url, thumbnail_url, synopsis, source_type, country_of_origin, age_rating, nsfw_level, " +
  "score, popularity, members, rank_overall, trending_score, broadcast_day, broadcast_time, " +
  ANN_COLS;

const LIST_COLS_MANGA =
  "id, mal_id, ann_id, title_romaji, title_english, title_native, synonyms, status, chapters, volumes, " +
  "authors, publisher, demographic, genres, tags, cover_url, synopsis, start_date, country_of_origin, " +
  "score, popularity, members, rank_overall, trending_score, " +
  ANN_COLS;

const colsDeListe = (type) => (type === "MANGA" ? LIST_COLS_MANGA : LIST_COLS);

/* Le jour de diffusion vient de MyAnimeList au singulier et en minuscules
   ("friday"), alors que ce code attendait la forme d'AniList au pluriel et
   capitalisée ("Fridays"). Résultat : PAS UNE SEULE correspondance ne
   marchait — calendrier vide, aucun compte à rebours, pastille « À suivre »
   muette. On normalise donc avant de chercher, et on accepte les deux
   écritures. La valeur "other" existe aussi côté MyAnimeList : elle ne
   désigne aucun jour, et doit rester sans correspondance. */
const JOURS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function indexJour(valeur) {
  if (!valeur) return undefined;
  const nettoye = String(valeur).trim().toLowerCase().replace(/s$/, "");
  const i = JOURS.indexOf(nettoye);
  return i === -1 ? undefined : i;
}

/* Approximation du prochain épisode : MAL ne donne qu'un créneau hebdo
   récurrent (jour + heure), pas un countdown exact épisode par épisode
   comme le nextAiringEpisode d'AniList. Le numéro d'épisode est estimé
   à partir de la date de début, pas garanti exact. */
function computeNextAiring(row) {
  if (row.status !== "RELEASING" || !row.broadcast_day) return null;
  const targetDow = indexJour(row.broadcast_day);
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

// Classification d'age MyAnimeList ("rx" = hentai), classification ANN
// ("AO" = adults only) et genres/themes explicites (voir excludeAdult).
function isAdultRow(row) {
  if (row.age_rating === "rx") return true;
  if (String(row.ann_objectionable || "").toUpperCase() === "AO") return true;
  const mots = ["hentai", "erotica"];
  const contient = (liste) => (liste || []).some((v) => mots.includes(String(v).toLowerCase()));
  return contient(row.genres) || contient(row.tags);
}

/* Jaquette et résumé : la valeur ANN passe devant quand elle existe.
   Ce n'est pas un détail d'affichage mais le cœur de la sortie de
   dépendance — 85 % des jaquettes anime sont aujourd'hui des liens vers le
   CDN MyAnimeList, dont l'accord soumet l'usage commercial à une
   autorisation écrite. Ce qui n'a pas d'équivalent ANN reste servi par
   MyAnimeList : l'ordre de préférence suffit à basculer le catalogue
   entier le jour où ces colonnes devront être vidées.
   `ann_*` vaut `undefined` quand la requête ne l'a pas demandé (voir
   ANN_COLS) : le `||` retombe alors naturellement sur la colonne d'origine. */
const jaquette = (row) => row.ann_cover_url || row.cover_url || null;
const resume = (row) => row.ann_synopsis || row.synopsis || null;

/* La note, elle, reste celle de MyAnimeList tant qu'elle existe : elle
   s'appuie sur des centaines de milliers de votes, contre quelques dizaines
   chez ANN. La note ANN ne prend le relais que sur les fiches sans note
   MyAnimeList, et seulement au-delà d'un seuil de votes — en dessous, un
   seul avis extrême déplace la moyenne d'un point entier. */
const ANN_VOTES_MIN = 20;

function noteAffichee(row) {
  if (row.score) return Math.round(row.score * 10);
  if (row.ann_rating && (row.ann_rating_votes || 0) >= ANN_VOTES_MIN) {
    return Math.round(row.ann_rating * 10);
  }
  return null;
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
    description: resume(row),
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
      extraLarge: jaquette(row),
      large: jaquette(row),
      medium: row.ann_cover_url || row.thumbnail_url || row.cover_url,
      color: null,
    },
    bannerImage: null, // généré côté UI depuis coverImage (voir src/lib/banner.js)
    genres: row.genres || [],
    synonyms: row.synonyms || [],
    tags: (row.tags || []).map((name) => ({ name, rank: null, category: null, isMediaSpoiler: false })),
    averageScore: noteAffichee(row),
    meanScore: noteAffichee(row),
    // Note ANN exposée à part, avec son nombre de votes : c'est une autre
    // grandeur que la moyenne MyAnimeList (quelques dizaines de votes contre
    // des centaines de milliers), et les confondre dans un même chiffre
    // donnerait une fausse impression de solidité. La fiche détaillée peut
    // les afficher côte à côte, chacune créditée à sa source.
    annScore: row.ann_rating ? Math.round(row.ann_rating * 10) : null,
    annScoreVotes: row.ann_rating_votes ?? null,
    // Sémantique AniList : `popularity` = nombre d'utilisateurs suivant l'œuvre.
    // Le rang MyAnimeList est exposé à part, car c'est une autre grandeur —
    // les confondre inversait tous les classements de l'app.
    popularity: row.members ?? null,
    popularityRank: row.popularity ?? null,
    favourites: 0,
    trending: row.trending_score ?? 0,
    // Meme regle que le filtre excludeAdult ci-dessous : nsfw_level ne vaut
    // jamais "black" cote MyAnimeList, il ne peut pas servir de signal.
    isAdult: isAdultRow(row),
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
  // Une serie pas encore sortie n'a pas d'episode avant sa date de debut :
  // sans cette garde, un titre qui demarre le 2 octobre apparaissait aussi
  // les vendredis de septembre.
  const debut = media._startDateRaw ? new Date(media._startDateRaw) : null;
  if (debut && referenceDate < debut) {
    const airingAt = Math.floor(debut.getTime() / 1000);
    return { airingAt, episode: 1, premiere: true };
  }
  if (!media._broadcastDay) return null;
  const targetDow = indexJour(media._broadcastDay);
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
const REL_COLS_ANIME = "id, ann_id, title_romaji, title_english, type, cover_url, ann_cover_url, status, episodes";
const REL_COLS_MANGA = "id, ann_id, title_romaji, title_english, cover_url, ann_cover_url, status, chapters";

async function hydrateRelations(mediaList) {
  const idsToFetch = [];
  for (const m of mediaList) {
    for (const edge of m.relations.edges) {
      if (!edge.node) idsToFetch.push(edge);
    }
  }
  if (idsToFetch.length === 0) return mediaList;

  // Deux espaces d'identifiants cohabitent : celui du catalogue (relations
  // MyAnimeList, déjà rebasées à l'import) et celui d'ANN (ann_related, tel
  // qu'ANN le publie). Ils se résolvent séparément, en une requête chacun.
  const allIds = [...new Set(idsToFetch.map((e) => e._rawId).filter(Boolean))];
  const allAnnIds = [...new Set(idsToFetch.map((e) => e._rawAnnId).filter(Boolean))];
  if (allIds.length === 0 && allAnnIds.length === 0) return mediaList;

  // Les deux tables : une œuvre liée peut être un manga (adaptation, œuvre
  // d'origine). La requête ne regardait que catalog_anime, donc aucune
  // relation d'un manga ne s'affichait jamais.
  const parId = (table, cols) =>
    allIds.length ? supabase.from(table).select(cols).in("id", allIds) : Promise.resolve({ data: [] });
  const parAnnId = (table, cols) =>
    allAnnIds.length
      ? supabase.from(table).select(cols).in("ann_id", allAnnIds)
      : Promise.resolve({ data: [] });

  const [animeRes, mangaRes, animeAnnRes, mangaAnnRes] = await Promise.all([
    parId("catalog_anime", REL_COLS_ANIME),
    parId("catalog_manga", REL_COLS_MANGA),
    parAnnId("catalog_anime", REL_COLS_ANIME),
    parAnnId("catalog_manga", REL_COLS_MANGA),
  ]);

  const byId = new Map();
  const byAnnId = new Map();
  const ranger = (rows, type) => {
    for (const r of rows || []) {
      // Un id n'appartient qu'à une seule des deux tables ; en cas de doublon
      // improbable, l'anime l'emporte (cas de très loin le plus courant).
      if (!byId.has(r.id)) byId.set(r.id, { ...r, _type: type });
      if (r.ann_id && !byAnnId.has(r.ann_id)) byAnnId.set(r.ann_id, { ...r, _type: type });
    }
  };
  ranger(animeRes.data, "ANIME");
  ranger(animeAnnRes.data, "ANIME");
  ranger(mangaRes.data, "MANGA");
  ranger(mangaAnnRes.data, "MANGA");

  for (const edge of idsToFetch) {
    const r = edge._rawAnnId ? byAnnId.get(edge._rawAnnId) : byId.get(edge._rawId);
    if (r) {
      edge.node = {
        id: r.id,
        title: { romaji: r.title_romaji, english: r.title_english },
        type: r._type,
        format: r._type === "ANIME" ? r.type : "MANGA",
        coverImage: { large: jaquette(r) },
        status: r.status,
        episodes: r._type === "ANIME" ? r.episodes : null,
        chapters: r._type === "ANIME" ? null : r.chapters,
      };
    }
  }

  /* Une même œuvre peut être décrite des deux côtés (MyAnimeList et ANN) :
     les doublons n'apparaissent qu'ici, une fois les ann_id traduits en
     identifiants du catalogue. La relation MyAnimeList est listée en
     premier, donc conservée. Les liens non résolus (œuvre absente du
     catalogue) sont écartés plutôt que laissés en carte vide. */
  for (const m of mediaList) {
    const vus = new Set();
    m.relations.edges = m.relations.edges.filter((e) => {
      if (!e.node) return false;
      if (vus.has(e.node.id)) return false;
      vus.add(e.node.id);
      return true;
    });
  }
  return mediaList;
}

/* Libellés ANN -> vocabulaire de relation déjà employé par le Modal. ANN
   dit d'où vient l'œuvre ("adapted from" pointe le manga d'origine) et ce
   qui la suit, là où MyAnimeList ne relie que des anime entre eux. */
const ANN_REL_MAP = {
  "adapted from": "ADAPTATION",
  "sequel of": "PREQUEL",
  sequel: "SEQUEL",
  "side story of": "PARENT",
  "side story": "SIDE_STORY",
  "spinoff of": "PARENT",
  spinoff: "SIDE_STORY",
  "alternative version of": "ALTERNATIVE",
  "alternative version": "ALTERNATIVE",
};

function attachRawRelationIds(media, row) {
  const edges = (row.relations || []).map((r) => ({
    relationType: r.relation_type,
    node: null,
    _rawId: r.id,
  }));

  /* Les relations MyAnimeList ne sont renseignées que sur 7,6 % des fiches,
     et ne sortent jamais de l'anime. Celles d'ANN complètent les deux
     manques d'un coup : elles couvrent tout ce qu'ANN connaît, et relient
     l'anime à son manga d'origine. Elles sont désignées par ann_id, pas par
     l'identifiant du catalogue : la résolution se fait dans
     hydrateRelations, avec les autres. */
  for (const r of row.ann_related || []) {
    if (!r?.ann_id) continue;
    edges.push({
      relationType: ANN_REL_MAP[String(r.rel || "").toLowerCase()] || "OTHER",
      node: null,
      _rawId: null,
      _rawAnnId: r.ann_id,
    });
  }

  media.relations.edges = edges;
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

/* --- Contenu adulte --------------------------------------------------
   Le filtre ne testait que `nsfw_level`, que MyAnimeList ne renseigne jamais
   a "black" : verifie le 2026-09-20 sur les 30 561 fiches enrichies, zero.
   1 630 hentai passaient donc dans la recherche, l'accueil et la page saison.

   Trois signaux fiables a la place :
     - la classification d'age MyAnimeList, "rx" = hentai ;
     - la classification ANN, "AO" (adults only) — signal independant,
       verifie le 2026-09-22 sur deux echantillons : 55 des 60 fiches
       classees "rx" par MyAnimeList sont "AO" chez ANN, et aucune des 150
       fiches les plus suivies ne l'est. Ne PAS elargir a "MA" (public
       averti), qui couvre quantite de series grand public — Sakamoto Days
       en fait partie ;
     - les genres/themes explicites, pour les fiches venues d'ANN ou du
       dataset qui n'ont aucune classification.
   Le manga n'a pas de colonne age_rating : ANN, genres et themes seuls. */
const ADULT_GENRES = ["Hentai", "Erotica", "erotica", "hentai"];
const ADULT_TAGS = ["hentai", "erotica"];

function excludeAdult(q, type) {
  // `neq` seul ecarterait aussi les lignes sans classification (NULL n'est
  // jamais different de quoi que ce soit en SQL) : d'ou le `or`.
  if (type === "ANIME") q = q.or("age_rating.is.null,age_rating.neq.rx");
  return q
    .or("ann_objectionable.is.null,ann_objectionable.neq.AO")
    .not("genres", "ov", `{${ADULT_GENRES.join(",")}}`)
    .not("tags", "ov", `{${ADULT_TAGS.join(",")}}`);
}

export async function fetchTrending({ page = 1, perPage = 50, isAdult = false } = {}) {
  let base = supabase.from("catalog_anime").select(LIST_COLS);
  if (!isAdult) base = excludeAdult(base, "ANIME");
  const { data, error } = await orderByPopularity(
    base
      // trending_score traduit une VARIATION de popularité entre deux
      // synchronisations (voir scripts/compute-trending.mjs) : c'est ce qui
      // fait qu'une tendance bouge au lieu d'être un palmarès figé.
      .order("trending_score", { ascending: false, nullsFirst: false }),
  ).range((page - 1) * perPage, page * perPage - 1);
  if (error) throw error;
  return mapRows(data || [], "ANIME");
}

export async function fetchSeasonal({ season, year, page = 1, perPage = 50, isAdult = false } = {}) {
  let q = supabase.from("catalog_anime").select(LIST_COLS).eq("season", season).eq("season_year", year);
  if (!isAdult) q = excludeAdult(q, "ANIME");
  const { data, error } = await orderByPopularity(q).range((page - 1) * perPage, page * perPage - 1);
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
  // Le comptage exact coûte cher : PostgREST doit parcourir toutes les lignes
  // qui passent les filtres, et le filtre « contenu adulte » porte sur deux
  // colonnes tableau, qu'aucun index ne sert en exclusion. Mesuré le
  // 2026-09-20 : 137 ms sans le compte, 2,8 s avec — assez pour dépasser le
  // délai maximal d'une requête et renvoyer une erreur 500 au navigateur.
  // Les écrans qui affichent un nombre de résultats le demandent
  // explicitement ; l'autocomplétion, elle, n'en a pas besoin.
  withCount = false,
} = {}) {
  const table = TABLE[type] || TABLE.ANIME;
  let q = supabase.from(table).select(colsDeListe(type), withCount ? { count: "exact" } : undefined);

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
  if (isAdult === false) q = excludeAdult(q, type);

  // Depuis la migration v3, catalog_manga porte les mêmes colonnes de
  // statistiques que catalog_anime : plus besoin de restreindre le tri par type.
  const orders = SORT_MAP[sort?.[0]] || SORT_MAP.POPULARITY_DESC;
  for (const [col, asc] of orders) q = q.order(col, { ascending: asc, nullsFirst: false });
  q = q.range((page - 1) * perPage, page * perPage - 1);

  const { data, error, count } = await q;
  if (error) throw error;
  const media = await mapRows(data || [], type);
  return {
    media,
    pageInfo: {
      total: count ?? null,
      currentPage: page,
      // Sans comptage, une page pleine signifie qu'il reste probablement
      // quelque chose derrière : c'est tout ce dont la pagination a besoin.
      hasNextPage: count != null ? page * perPage < count : (data || []).length === perPage,
    },
  };
}

/* ─── Calendrier de diffusion (remplace Q_WEEK local de Calendar.jsx) ─
   Pas de calendrier épisode-par-épisode exact disponible sans AniList :
   on renvoie les animes en cours de diffusion avec leur créneau hebdo
   approximatif, filtré côté composant sur la semaine affichée. */
export async function fetchAiringAnime({ isAdult = false } = {}) {
  // On ne garde pas que les series deja en cours : une saison demarre en
  // octobre, et fin septembre un calendrier qui n'affiche que le deja-diffuse
  // parait vide. Les series a venir dont la date de debut est connue y
  // figurent donc aussi, ce qui donne les premieres.
  const horizon = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  let q = supabase
    .from("catalog_anime")
    .select(LIST_COLS)
    .in("status", ["RELEASING", "NOT_YET_RELEASED"])
    .not("start_date", "is", null)
    .lte("start_date", horizon);
  if (!isAdult) q = excludeAdult(q, "ANIME");
  const { data, error } = await q;
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
  // DOMParser plutôt qu'un div + innerHTML : innerHTML déclenche le chargement
  // des ressources, donc le onerror d'une balise <img> piégée, même sur un
  // élément jamais inséré dans la page. Les synopsis viennent de sources
  // externes (MyAnimeList, ANN) : on ne leur fait pas confiance à ce point.
  const doc = new DOMParser().parseFromString(html, "text/html");
  const text = (doc.body?.textContent || "").replace(/\n+/g, " ").trim();
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
