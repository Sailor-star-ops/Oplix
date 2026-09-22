-- ═══════════════════════════════════════════════════════════════════
-- Oplix — Ménage v5 : sortir les dernières dépendances à friendships_old
-- À exécuter dans l'éditeur SQL Supabase. Idempotent.
--
-- CE QUE LA PREMIÈRE TENTATIVE A RÉVÉLÉ (2026-09-20) : deux règles d'accès
-- décidaient encore qui voit les collections privées en interrogeant
-- `friendships_old`, l'ancienne table d'amitiés :
--     collections_visible_to_friends      (sur collections)
--     collection_items_visible_to_friends (sur collection_items)
-- Un `drop ... cascade` les aurait supprimées au passage, et la visibilité
-- entre proches aurait disparu sans que rien ne le signale.
--
-- Ce fichier les remplace par l'équivalent dans le modèle actuel (follows),
-- AVANT de supprimer la table.
--
-- MODÈLE SOCIAL RETENU (décision du 2026-09-20) : le suivi est ASYMÉTRIQUE.
-- Suivre quelqu'un ne l'oblige à rien, et ne donne aucun droit sur lui.
-- L'équivalent exact d'une « amitié acceptée » est donc l'abonnement
-- MUTUEL : les deux personnes se suivent. C'est le choix le plus étroit,
-- celui qui n'élargit l'accès à personne par rapport à aujourd'hui.
--
-- Pour ouvrir plus tard aux simples abonnés, il suffira de remplacer la
-- double condition par une seule (voir le commentaire dans la règle).
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. collections : visibilité entre abonnés mutuels ───────────────
drop policy if exists collections_visible_to_friends on collections;

create policy "collections: abonnements mutuels" on collections
  for select to authenticated using (
    exists (
      -- je suis cette personne...
      select 1 from follows moi
      where moi.follower_id = auth.uid()
        and moi.followed_id = collections.user_id
    )
    and exists (
      -- ...et elle me suit en retour.
      -- Supprimer ce second bloc ouvrirait les collections privées à toute
      -- personne que je suis, sans réciprocité.
      select 1 from follows lui
      where lui.follower_id = collections.user_id
        and lui.followed_id = auth.uid()
    )
  );

-- ─── 2. collection_items : même règle, via la collection parente ─────
drop policy if exists collection_items_visible_to_friends on collection_items;

create policy "collection_items: abonnements mutuels" on collection_items
  for select to authenticated using (
    exists (
      select 1
      from collections c
      join follows moi on moi.follower_id = auth.uid() and moi.followed_id = c.user_id
      join follows lui on lui.follower_id = c.user_id and lui.followed_id = auth.uid()
      where c.id = collection_items.collection_id
    )
  );

-- ─── 3. Tables mortes ────────────────────────────────────────────────
-- `calendar` : vide (0 ligne), deux colonnes, jamais référencée dans src/.
drop table if exists calendar;

-- `friendships_old` : ancienne table d'amitiés, conservée « pour rollback »
-- lors du passage aux follows (supabase_social.sql, 2026-08-30). Les follows
-- tournent depuis trois semaines et portent 6 lignes.
--
-- Son contenu, recopié avant suppression pour qu'aucune information
-- ne parte sans trace. Les deux lignes « accepted » existent déjà dans
-- `follows` ; la demande « pending » n'a jamais été migrée, le suivi
-- asymétrique n'ayant pas de notion de demande en attente.
--
--   id                                    requester_id                          addressee_id                          status     created_at
--   <identifiant de compte retiré>  <identifiant de compte retiré>  <identifiant de compte retiré>  pending    2026-08-29 22:00:03
--   <identifiant de compte retiré>  <identifiant de compte retiré>  <identifiant de compte retiré>  accepted   2026-08-29 21:59:52
--   <identifiant de compte retiré>  <identifiant de compte retiré>  <identifiant de compte retiré>  accepted   2026-08-30 21:12:03
drop table if exists friendships_old;

-- ─── 4. Vérification ─────────────────────────────────────────────────
-- Après exécution, cette requête doit renvoyer les deux nouvelles règles
-- et plus aucune mention de friendships_old :
--
--   select tablename, policyname, qual
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('collections', 'collection_items');
