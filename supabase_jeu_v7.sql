-- ═══════════════════════════════════════════════════════════════════
-- Oplix — Migration v7 : résultats du jeu quotidien
-- À exécuter dans l'éditeur SQL Supabase. Rejouable sans risque.
--
-- Une ligne par joueur, par jour et par mode. C'est ce qui permet le
-- classement entre abonnements et le classement mondial : sans stockage
-- côté serveur, la grille partagée ne raconte rien à personne.
--
-- Aucun texte libre : uniquement des nombres et des booléens. Rien à
-- modérer, et rien qui puisse spoiler la réponse du jour.
--
-- CORRECTION DU 2026-09-22 : la première version nommait une politique
-- « daily_results: j''enregistre ma partie ». Entre guillemets doubles,
-- Postgres ne voit PAS '' comme une apostrophe échappée : la politique
-- créée portait donc deux apostrophes, alors que le test d'existence en
-- cherchait une seule. Le fichier n'était pas rejouable — il échouait au
-- deuxième passage avec « policy already exists ». Plus aucune apostrophe
-- dans un nom de politique ici, et l'ancienne est supprimée si elle traîne.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists daily_results (
  user_id uuid not null references profiles(id) on delete cascade,
  jour date not null,
  mode text not null check (mode in ('normal', 'expert')),
  essais smallint not null check (essais between 1 and 6),
  trouve boolean not null,
  duree_ms integer,
  created_at timestamptz not null default now(),
  primary key (user_id, jour, mode)
);

create index if not exists daily_results_jour_idx on daily_results (jour desc, mode);
create index if not exists daily_results_user_idx on daily_results (user_id, jour desc);

alter table daily_results enable row level security;

-- Nettoyage des politiques, quel que soit l'état laissé par les passages
-- précédents : on repart d'une base connue plutôt que de tester des noms.
drop policy if exists "daily_results: lecture par les membres" on daily_results;
drop policy if exists "daily_results: j''enregistre ma partie" on daily_results;
drop policy if exists "daily_results: j'enregistre ma partie" on daily_results;
drop policy if exists "daily_results: enregistrement de ma partie" on daily_results;

-- Lecture ouverte aux comptes connectés : c'est ce qui rend les classements
-- possibles. Une ligne ne contient qu'un nombre d'essais, jamais de titre.
create policy "daily_results: lecture par les membres" on daily_results
  for select to authenticated using (true);

create policy "daily_results: enregistrement de ma partie" on daily_results
  for insert to authenticated with check (auth.uid() = user_id);

-- Pas de politique UPDATE ni DELETE : une partie enregistrée ne se rejoue
-- pas, et personne ne peut corriger son score après coup.

-- ─── Classement mondial du jour ──────────────────────────────────────
-- Une vue plutôt qu'un comptage côté client : elle ne laisse sortir que des
-- agrégats, jamais la liste des joueurs.
create or replace view daily_stats as
select
  jour,
  mode,
  count(*)::int as joueurs,
  count(*) filter (where trouve)::int as trouveurs,
  round(avg(essais) filter (where trouve), 2) as essais_moyens,
  min(essais) filter (where trouve)::int as meilleur
from daily_results
group by jour, mode;

grant select on daily_stats to authenticated, anon;

-- ─── Classement sur trente jours ─────────────────────────────────────
-- Le score récompense la régularité autant que la performance : une partie
-- trouvée vaut sept points moins le nombre d'essais, une partie perdue zéro.
create or replace view daily_classement as
select
  user_id,
  mode,
  count(*) filter (where trouve)::int as victoires,
  count(*)::int as parties,
  sum(case when trouve then 7 - essais else 0 end)::int as points,
  round(avg(essais) filter (where trouve), 2) as essais_moyens
from daily_results
where jour >= current_date - 30
group by user_id, mode;

grant select on daily_classement to authenticated;

-- ─── Vérification ────────────────────────────────────────────────────
-- Doit renvoyer exactement deux lignes, sans apostrophe dans les noms :
--
--   select policyname, cmd, roles::text
--   from pg_policies
--   where schemaname = 'public' and tablename = 'daily_results';
