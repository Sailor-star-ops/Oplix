-- ═══════════════════════════════════════════════════════════════════
-- Oplix — Migration v4 : confidentialité des profils et pages publiques
-- À exécuter dans l'éditeur SQL Supabase. Idempotent.
--
-- CONSTAT (vérifié le 2026-09-20 avec la clé anon, celle du navigateur) :
--   • n'importe qui, sans compte, peut lire TOUS les profils — y compris
--     les 5 profils dont is_public vaut false — avec toutes leurs colonnes
--     (bio, favoris, statistiques, et le share_code qui sert de lien privé) ;
--   • à l'inverse, un visiteur non connecté ne peut lire AUCUNE collection,
--     donc la page de collection partagée (?c=) ne montre rien tant qu'on
--     n'est pas connecté.
--
-- Les deux réglages sont donc à l'envers de l'intention. Ce fichier remet
-- chacun dans le bon sens.
--
-- CONSÉQUENCE À CONNAÎTRE : après cette migration, un lien de profil partagé
-- (?p=) ne s'ouvrira pour un visiteur non connecté que si le profil est
-- public. C'est le sens de la case « profil public » — la base ne peut pas
-- savoir qu'un visiteur détient le bon share_code.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. profiles : le public ne voit que les profils publics ─────────
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT'
  loop
    raise notice 'Ancienne politique de lecture supprimée : %', p.policyname;
    execute format('drop policy %I on public.profiles', p.policyname);
  end loop;

  -- Une politique "ALL" couvrirait aussi la lecture : on prévient au lieu de
  -- la supprimer, car elle porte également les droits d'écriture.
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and cmd = 'ALL'
  loop
    raise warning 'Politique ALL restante sur profiles (%) : elle autorise encore la lecture à tous, à revoir à la main.', p.policyname;
  end loop;
end $$;

create policy "profiles: profils publics" on profiles
  for select to anon using (is_public = true);

-- Les pages Amis, Classement et le fil social listent les autres membres :
-- la lecture reste ouverte aux comptes connectés.
create policy "profiles: membres connectes" on profiles
  for select to authenticated using (true);

-- ─── 2. collections publiques lisibles sans compte ───────────────────
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'collections'
      and policyname = 'collections: collections publiques'
  ) then
    create policy "collections: collections publiques" on collections
      for select to anon using (is_public = true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'collection_items'
      and policyname = 'collection_items: contenu des collections publiques'
  ) then
    create policy "collection_items: contenu des collections publiques" on collection_items
      for select to anon using (
        exists (
          select 1 from collections c
          where c.id = collection_items.collection_id and c.is_public
        )
      );
  end if;
end $$;

-- ─── 3. Tables mortes ────────────────────────────────────────────────
-- Déplacé dans supabase_menage_v5.sql, qui recopie le contenu de
-- friendships_old avant de la supprimer.
