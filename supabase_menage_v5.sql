-- ═══════════════════════════════════════════════════════════════════
-- Oplix — Ménage v5 : suppression de deux tables mortes
-- À exécuter dans l'éditeur SQL Supabase. Idempotent.
--
-- Supabase affichera un avertissement « opérations destructives » : c'est
-- attendu, ce fichier supprime bien deux tables. Aucune n'est utilisée par
-- le code de l'application (vérifié le 2026-09-20 : aucune occurrence de
-- `calendar` ni de `friendships_old` dans src/).
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. calendar ─────────────────────────────────────────────────────
-- Table vide (0 ligne), deux colonnes (id, created_at), jamais référencée.
-- Vestige d'une première version de la page Calendrier, qui lit aujourd'hui
-- directement catalog_anime.
drop table if exists calendar;

-- ─── 2. friendships_old ──────────────────────────────────────────────
-- Ancienne table d'amitiés, renommée puis conservée « pour rollback » lors du
-- passage aux follows asymétriques (supabase_social.sql, 2026-08-30). Les
-- follows fonctionnent depuis trois semaines et portent 6 lignes : le retour
-- en arrière n'a plus de sens.
--
-- Son contenu intégral est recopié ici avant suppression, pour qu'aucune
-- information ne disparaisse sans trace. Les deux relations « accepted »
-- existent déjà dans `follows` ; la demande « pending » n'a jamais été
-- migrée, le modèle de follow n'ayant pas de notion de demande en attente.
--
--   id                                    requester_id                          addressee_id                          status     created_at
--   identifiant-retire  identifiant-retire  identifiant-retire  pending    2026-08-29 22:00:03
--   identifiant-retire  identifiant-retire  identifiant-retire  accepted   2026-08-29 21:59:52
--   identifiant-retire  identifiant-retire  identifiant-retire  accepted   2026-08-30 21:12:03
--
-- Pour recréer la demande en attente dans le futur modèle, il suffira de la
-- réinsérer à la main : c'est une ligne, pas une table.
drop table if exists friendships_old;
