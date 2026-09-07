-- ═══════════════════════════════════════════════════════════════════
-- Oplix — Espace social sans modération
-- À exécuter manuellement dans l'éditeur SQL Supabase (le client de
-- l'app n'a que la clé anon, pas d'accès admin pour lancer ceci).
-- ═══════════════════════════════════════════════════════════════════

-- ─── follows : remplace friendships par un follow asymétrique ───────
create table if not exists follows (
  follower_id uuid not null references profiles(id) on delete cascade,
  followed_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint follows_not_self check (follower_id <> followed_id)
);

alter table follows enable row level security;

create policy "follows: lecture authentifiée" on follows
  for select using (auth.role() = 'authenticated');

create policy "follows: je peux suivre" on follows
  for insert with check (auth.uid() = follower_id);

create policy "follows: je peux ne plus suivre" on follows
  for delete using (auth.uid() = follower_id);

-- Migration des amitiés acceptées existantes vers des follows mutuels.
-- Les demandes en attente (pending) n'ont pas d'équivalent en follow
-- libre et sont abandonnées. Jointure sur profiles pour écarter les
-- lignes orphelines (compte supprimé dont le profil n'existe plus).
insert into follows (follower_id, followed_id)
select f.requester_id, f.addressee_id
from friendships f
join profiles pr on pr.id = f.requester_id
join profiles pa on pa.id = f.addressee_id
where f.status = 'accepted'
on conflict do nothing;

insert into follows (follower_id, followed_id)
select f.addressee_id, f.requester_id
from friendships f
join profiles pr on pr.id = f.requester_id
join profiles pa on pa.id = f.addressee_id
where f.status = 'accepted'
on conflict do nothing;

-- Ancienne table conservée pour rollback, renommée pour libérer le nom.
alter table if exists friendships rename to friendships_old;

-- ─── activity_events : fil d'activité auto-généré, zéro texte libre ──
create table if not exists activity_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('completed', 'rating', 'started_watching')),
  anilist_id integer not null,
  anime_title text not null,
  anime_image text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_events_user_created_idx
  on activity_events (user_id, created_at desc);

alter table activity_events enable row level security;

create policy "activity_events: lecture authentifiée" on activity_events
  for select using (auth.role() = 'authenticated');

create policy "activity_events: j'écris les miens" on activity_events
  for insert with check (auth.uid() = user_id);

-- ─── kudos : réaction en un tap sur une entrée du fil ────────────────
create table if not exists kudos (
  id bigint generated always as identity primary key,
  activity_id bigint not null references activity_events(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (activity_id, user_id)
);

alter table kudos enable row level security;

create policy "kudos: lecture authentifiée" on kudos
  for select using (auth.role() = 'authenticated');

create policy "kudos: je peux réagir" on kudos
  for insert with check (auth.uid() = user_id);

create policy "kudos: je peux retirer ma réaction" on kudos
  for delete using (auth.uid() = user_id);

-- ─── collection_likes : like sur une collection ──────────────────────
-- Le type de collections.id n'est pas vérifiable depuis le client (clé
-- anon seule) — ajuste `uuid` ci-dessous en `bigint` si ta table
-- collections utilise un id numérique (vérifie dans Table Editor).
create table if not exists collection_likes (
  id bigint generated always as identity primary key,
  collection_id uuid not null references collections(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (collection_id, user_id)
);

alter table collection_likes enable row level security;

create policy "collection_likes: lecture authentifiée" on collection_likes
  for select using (auth.role() = 'authenticated');

create policy "collection_likes: je peux liker" on collection_likes
  for insert with check (auth.uid() = user_id);

create policy "collection_likes: je peux retirer mon like" on collection_likes
  for delete using (auth.uid() = user_id);

-- ─── profiles : objectif annuel + streak hebdomadaire ────────────────
alter table profiles
  add column if not exists annual_goal integer,
  add column if not exists weekly_streak_count integer not null default 0,
  add column if not exists weekly_streak_updated_at timestamptz;
