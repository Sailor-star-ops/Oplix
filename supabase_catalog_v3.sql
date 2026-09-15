-- ═══════════════════════════════════════════════════════════════════
-- Oplix — Migration catalogue v3
-- À exécuter dans l'éditeur SQL Supabase, APRÈS supabase_catalog_v2.sql.
-- Idempotent : ré-exécutable sans risque.
--
-- Trois chantiers :
--   1. Distinguer le RANG de popularité du NOMBRE de membres. La colonne
--      `popularity` contient le rang MyAnimeList (1 = le plus populaire),
--      pas un volume — trier dessus en décroissant remontait les fiches les
--      plus obscures du catalogue. `members` accueille le vrai volume.
--   2. Rendre l'enrichissement MyAnimeList reprenable (`mal_synced_at`),
--      pour qu'un run interrompu ne reparte pas de zéro.
--   3. Donner au manga les statistiques qu'il n'a jamais eues (score,
--      popularité, classement, tags), et poser de quoi calculer une vraie
--      tendance dans le temps.
-- ═══════════════════════════════════════════════════════════════════

-- ─── catalog_anime ───────────────────────────────────────────────────

-- Nombre d'utilisateurs ayant l'œuvre en liste (MAL `num_list_users`).
-- C'est LE champ à trier en décroissant ; `popularity` est un rang.
alter table catalog_anime add column if not exists members integer;

-- Reprise de l'enrichissement MyAnimeList : ~30 500 requêtes à 1/s, soit près
-- de 9 heures. Sans cette colonne, toute interruption faisait tout recommencer.
alter table catalog_anime add column if not exists mal_synced_at timestamptz;

-- Score de tendance recalculé à chaque sync (voir scripts/compute-trending.mjs).
alter table catalog_anime add column if not exists trending_score numeric;

-- URL d'origine conservée quand la jaquette est rapatriée dans Supabase Storage.
alter table catalog_anime add column if not exists cover_origin_url text;

create index if not exists catalog_anime_members_idx on catalog_anime (members desc nulls last);
create index if not exists catalog_anime_trending_idx on catalog_anime (trending_score desc nulls last);
create index if not exists catalog_anime_mal_sync_idx on catalog_anime (mal_synced_at nulls first);

-- ─── catalog_manga ───────────────────────────────────────────────────
-- Le manga n'avait aucune statistique : ni score, ni popularité, ni tags.
-- L'API manga de MyAnimeList expose pourtant mean / popularity /
-- num_list_users / rank exactement comme l'API anime — ils n'étaient
-- simplement jamais demandés.
alter table catalog_manga add column if not exists score numeric;
alter table catalog_manga add column if not exists popularity integer;
alter table catalog_manga add column if not exists members integer;
alter table catalog_manga add column if not exists rank_overall integer;
alter table catalog_manga add column if not exists tags text[] not null default '{}';
alter table catalog_manga add column if not exists mal_synced_at timestamptz;
alter table catalog_manga add column if not exists trending_score numeric;
alter table catalog_manga add column if not exists cover_origin_url text;

create index if not exists catalog_manga_members_idx on catalog_manga (members desc nulls last);
create index if not exists catalog_manga_score_idx on catalog_manga (score desc nulls last);
create index if not exists catalog_manga_trending_idx on catalog_manga (trending_score desc nulls last);
create index if not exists catalog_manga_tags_idx on catalog_manga using gin (tags);
create index if not exists catalog_manga_mal_sync_idx on catalog_manga (mal_synced_at nulls first);

-- ─── Historique de popularité ────────────────────────────────────────
-- Une vraie tendance, c'est une VARIATION, pas un classement figé. AniList
-- la calculait sur l'activité de ses propres utilisateurs ; Oplix n'en a pas
-- encore assez pour ça, mais peut mesurer le mouvement du rang MyAnimeList
-- d'une synchronisation à l'autre. Chaque sync dépose un point ici, et la
-- tendance devient exploitable dès le deuxième relevé.
create table if not exists catalog_trend_snapshot (
  media_type text not null check (media_type in ('ANIME', 'MANGA')),
  media_id integer not null,
  captured_on date not null default current_date,
  popularity integer,   -- rang MyAnimeList
  members integer,      -- volume d'utilisateurs
  score numeric,
  primary key (media_type, media_id, captured_on)
);

create index if not exists catalog_trend_captured_idx on catalog_trend_snapshot (captured_on desc);

alter table catalog_trend_snapshot enable row level security;

create policy "catalog_trend_snapshot: lecture publique" on catalog_trend_snapshot
  for select using (true);
