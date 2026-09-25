-- ═══════════════════════════════════════════════════════════════════
-- Oplix — Migration catalogue v4 : indépendance MyAnimeList
-- À exécuter dans l'éditeur SQL Supabase, APRÈS supabase_catalog_v3.sql.
-- Idempotent : ré-exécutable sans risque.
--
-- POURQUOI
-- L'accord API MyAnimeList soumet l'usage commercial à une autorisation
-- écrite préalable (§3(a)(xiv)) et autorise une coupure d'accès sans
-- préavis (§12). Aujourd'hui, rien en base ne dit de quelle source vient
-- une valeur : la jaquette se devine à son domaine, mais le synopsis, le
-- score ou la classification d'âge sont indistinguables une fois écrits.
-- Impossible, dans cet état, de retirer les données MyAnimeList sans
-- vider aussi ce qu'Anime News Network a fourni.
--
-- CE QUE FAIT CETTE MIGRATION
-- Elle donne à ANN ses propres colonnes, écrites telles quelles par
-- sync-ann.mjs, sans jamais écraser ni dépendre des colonnes existantes.
-- Trois conséquences :
--   1. la provenance devient exacte, plus déduite ;
--   2. le client peut préférer la valeur ANN à l'affichage (voir
--      toMediaShape dans src/lib/catalog.js) ;
--   3. si MyAnimeList coupe l'accès, un UPDATE qui passe les colonnes
--      MyAnimeList à NULL suffit — le catalogue continue de tourner sur
--      ce qui reste.
--
-- Aucune colonne existante n'est modifiée ni supprimée : catalog_anime.id
-- et catalog_manga.id, référencés par watchlist / collection_items /
-- activity_events / episode_logs / profiles.favorite_animes, ne bougent pas.
-- ═══════════════════════════════════════════════════════════════════

-- ─── catalog_anime ───────────────────────────────────────────────────

-- Note pondérée ANN et son nombre de votes. Signal de qualité indépendant
-- de MyAnimeList. Bien moins voté (quelques dizaines contre des centaines
-- de milliers) : à traiter comme une note de repli, pas comme un
-- remplacement à volume égal — d'où le nombre de votes, stocké pour
-- pouvoir pondérer ou masquer un score appuyé sur trop peu d'avis.
alter table catalog_anime add column if not exists ann_rating numeric;
alter table catalog_anime add column if not exists ann_rating_votes integer;

-- Jaquette et résumé tels que publiés par ANN, conservés à part de
-- cover_url / synopsis qui peuvent venir de MyAnimeList ou du dataset.
alter table catalog_anime add column if not exists ann_cover_url text;
alter table catalog_anime add column if not exists ann_synopsis text;

-- Champ « Objectionable content » d'ANN (TA / MA / no / …). Le filtre
-- adulte ne repose aujourd'hui que sur age_rating, donc entièrement sur
-- MyAnimeList : ce champ lui donne un second signal, d'une autre source.
alter table catalog_anime add column if not exists ann_objectionable text;

-- Œuvres liées vues par ANN : [{ "ann_id": 4199, "rel": "adapted from",
-- "direction": "prev" }]. La colonne `relations` existante vient de
-- MyAnimeList et n'est renseignée que sur 7,6 % des fiches ; surtout,
-- elle ne relie que des anime entre eux. ANN relie aussi l'anime à son
-- manga d'origine — la base du « et après ? » côté produit, qui ne doit
-- justement pas être construit sur des données MyAnimeList.
alter table catalog_anime add column if not exists ann_related jsonb not null default '[]'::jsonb;

-- ─── catalog_manga ───────────────────────────────────────────────────

alter table catalog_manga add column if not exists ann_rating numeric;
alter table catalog_manga add column if not exists ann_rating_votes integer;
alter table catalog_manga add column if not exists ann_cover_url text;
alter table catalog_manga add column if not exists ann_synopsis text;
alter table catalog_manga add column if not exists ann_objectionable text;
alter table catalog_manga add column if not exists ann_related jsonb not null default '[]'::jsonb;

-- ─── Index ───────────────────────────────────────────────────────────

-- Le classement de repli, si le score MyAnimeList disparaît, trie sur
-- ann_rating en écartant les fiches trop peu votées.
create index if not exists catalog_anime_ann_rating_idx
  on catalog_anime (ann_rating desc nulls last) where ann_rating is not null;
create index if not exists catalog_manga_ann_rating_idx
  on catalog_manga (ann_rating desc nulls last) where ann_rating is not null;
