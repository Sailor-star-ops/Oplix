-- ═══════════════════════════════════════════════════════════════════
-- Oplix — Catalogue anime/manga interne (remplace la dépendance directe
-- à AniList, refusée par AniList pour un tracker concurrent).
-- À exécuter manuellement dans l'éditeur SQL Supabase (le client de
-- l'app n'a que la clé anon, pas d'accès admin pour lancer ceci).
--
-- Alimenté uniquement par scripts/sync-anime.mjs et
-- scripts/sync-manga-wikidata.mjs, via la clé service role (qui
-- contourne la RLS). Le client de l'app ne fait que lire.
-- ═══════════════════════════════════════════════════════════════════

-- ─── catalog_anime ───────────────────────────────────────────────────
-- id = ID AniList réutilisé tel quel (présent dans anime-offline-database
-- via son champ `sources`) : évite toute migration de watchlist,
-- collection_items, activity_events, episode_logs, profiles.favorite_animes,
-- qui référencent déjà cet entier.
create table if not exists catalog_anime (
  id integer primary key,
  mal_id integer,
  anidb_id integer,
  kitsu_id integer,

  title_romaji text,
  title_english text,
  title_native text,
  synonyms text[] not null default '{}',

  type text,                 -- TV / MOVIE / OVA / ONA / SPECIAL / MUSIC / TV_SHORT
  status text,                -- RELEASING / FINISHED / NOT_YET_RELEASED / CANCELLED / HIATUS
  episodes integer,
  duration_minutes integer,

  season text,                 -- WINTER / SPRING / SUMMER / FALL
  season_year integer,
  start_date date,
  end_date date,

  studios text[] not null default '{}',
  producers text[] not null default '{}',
  genres text[] not null default '{}',
  tags text[] not null default '{}',

  cover_url text,               -- hotlink direct vers le CDN MAL, jamais recopié
  thumbnail_url text,
  synopsis text,

  source_type text,             -- MANGA / LIGHT_NOVEL / ORIGINAL / WEB_NOVEL / GAME / OTHER...
  country_of_origin text,
  age_rating text,              -- classification MAL (g / pg_13 / r / rx...)
  nsfw_level text,               -- white / gray / black (MAL)

  score numeric,
  popularity integer,

  broadcast_day text,           -- jour de diffusion hebdo (MAL), pour approx. du prochain épisode
  broadcast_time text,

  relations jsonb not null default '[]',  -- [{ id, relation_type }], depuis MAL related_anime

  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists catalog_anime_genres_idx on catalog_anime using gin (genres);
create index if not exists catalog_anime_tags_idx on catalog_anime using gin (tags);
create index if not exists catalog_anime_status_idx on catalog_anime (status);
create index if not exists catalog_anime_season_idx on catalog_anime (season_year, season);
create index if not exists catalog_anime_type_idx on catalog_anime (type);
create index if not exists catalog_anime_mal_id_idx on catalog_anime (mal_id);

alter table catalog_anime enable row level security;

create policy "catalog_anime: lecture publique" on catalog_anime
  for select using (true);

-- ─── catalog_manga ───────────────────────────────────────────────────
-- id = ID AniList quand Wikidata le connaît (propriété P8731), sinon un
-- ID interne assigné dans une plage réservée (>= 900000000, au-dessus
-- de tout ID AniList réel) pour rester dans la même colonne integer.
create table if not exists catalog_manga (
  id integer primary key,
  mal_id integer,

  title_romaji text,
  title_english text,
  title_native text,
  synonyms text[] not null default '{}',

  authors text[] not null default '{}',
  publisher text,
  status text,
  volumes integer,
  chapters integer,
  demographic text,             -- shounen / shoujo / seinen / josei

  genres text[] not null default '{}',
  synopsis text,
  cover_url text,                -- souvent absent (pas de MangaDex) — connu et accepté

  start_date date,

  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists catalog_manga_genres_idx on catalog_manga using gin (genres);
create index if not exists catalog_manga_status_idx on catalog_manga (status);
create index if not exists catalog_manga_mal_id_idx on catalog_manga (mal_id);

alter table catalog_manga enable row level security;

create policy "catalog_manga: lecture publique" on catalog_manga
  for select using (true);
