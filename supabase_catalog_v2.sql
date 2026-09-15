-- ═══════════════════════════════════════════════════════════════════
-- Oplix — Migration catalogue v2
-- À exécuter dans l'éditeur SQL Supabase, APRÈS supabase_catalog.sql.
-- Idempotent : ré-exécutable sans risque.
--
-- Ajoute les colonnes nécessaires à l'enrichissement Anime News Network
-- (scripts/sync-ann.mjs) : titres multilingues, équipe, casting (dont VF),
-- liens officiels, thèmes musicaux, classement, mention de copyright.
--
-- Aucune colonne existante n'est modifiée ni supprimée : les watchlists,
-- collections et logs d'épisodes référencent catalog_anime.id, qui ne
-- change pas.
-- ═══════════════════════════════════════════════════════════════════

-- ─── catalog_anime ───────────────────────────────────────────────────

alter table catalog_anime add column if not exists ann_id integer;

-- Titres par langue : { "EN": ["..."], "FR": ["..."], "JA": ["..."], ... }
-- ANN fournit jusqu'à 9 langues ; title_english / title_native restent
-- renseignés en parallèle pour ne rien casser côté client.
alter table catalog_anime add column if not exists titles jsonb not null default '{}'::jsonb;

-- [{ "name": "Seiji Mizushima", "task": "Director" }]
alter table catalog_anime add column if not exists staff jsonb not null default '[]'::jsonb;

-- [{ "name": "Edward Elric", "actors": [{ "name": "Arthur Pestel", "lang": "FR" }] }]
alter table catalog_anime add column if not exists characters jsonb not null default '[]'::jsonb;

-- [{ "label": "Site officiel", "url": "https://..." }]
alter table catalog_anime add column if not exists external_links jsonb not null default '[]'::jsonb;

alter table catalog_anime add column if not exists opening_themes text[] not null default '{}';
alter table catalog_anime add column if not exists ending_themes  text[] not null default '{}';

-- Classement général MyAnimeList (champ `rank` de l'API v2)
alter table catalog_anime add column if not exists rank_overall integer;

-- Licencié hors Japon (ANN suit les licences par territoire)
alter table catalog_anime add column if not exists is_licensed boolean;

-- Mention légale de l'ayant droit, telle que publiée par ANN
alter table catalog_anime add column if not exists copyright_notice text;

alter table catalog_anime add column if not exists ann_synced_at timestamptz;

create index if not exists catalog_anime_ann_id_idx on catalog_anime (ann_id);

-- ─── catalog_manga ───────────────────────────────────────────────────

alter table catalog_manga add column if not exists ann_id integer;
alter table catalog_manga add column if not exists titles jsonb not null default '{}'::jsonb;
alter table catalog_manga add column if not exists staff jsonb not null default '[]'::jsonb;
alter table catalog_manga add column if not exists external_links jsonb not null default '[]'::jsonb;
alter table catalog_manga add column if not exists copyright_notice text;
alter table catalog_manga add column if not exists ann_synced_at timestamptz;

-- Wikidata élargi : pays d'origine et genres côté manga
alter table catalog_manga add column if not exists country_of_origin text;

-- Clé de rapprochement des manga ANN avec les manga Wikidata déjà en base
-- (ANN ne partage aucun identifiant croisé côté manga, contrairement à
-- l'anime — on déduplique donc sur un titre normalisé).
alter table catalog_manga add column if not exists title_key text;
create index if not exists catalog_manga_title_key_idx on catalog_manga (title_key);

create index if not exists catalog_manga_ann_id_idx on catalog_manga (ann_id);
