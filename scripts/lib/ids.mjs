// Plages d'identifiants internes du catalogue Oplix.
//
// catalog_anime.id et catalog_manga.id sont référencés par watchlist,
// collection_items, activity_events, episode_logs et profiles.favorite_animes.
// Ces identifiants ne doivent JAMAIS changer pour une œuvre déjà en base,
// sous peine d'orpheliner les listes des utilisateurs.
//
// Règle : on garde l'ID AniList quand il existe (c'est le schéma historique),
// et on dérive un ID stable dans une plage réservée pour tout le reste.
// Chaque plage est déterministe — deux exécutions donnent le même ID.

export const ID_RANGE = {
  MAL: 900_000_000, // anime/manga connus de MyAnimeList mais pas d'AniList
  ANN: 800_000_000, // œuvres connues seulement d'Anime News Network
  WIKIDATA: 900_000_000, // manga issus de Wikidata sans croisement AniList
};

// Garde-fou : la colonne est un integer Postgres (max 2 147 483 647).
const INT4_MAX = 2_147_483_647;

function safe(base, n, label) {
  if (!Number.isInteger(n) || n <= 0) return null;
  const id = base + n;
  if (id > INT4_MAX) {
    console.warn(`ID ${label} hors plage integer (${id}) — entrée ignorée.`);
    return null;
  }
  return id;
}

export const fromMalId = (n) => safe(ID_RANGE.MAL, n, "MAL");
export const fromAnnId = (n) => safe(ID_RANGE.ANN, n, "ANN");

// Titre normalisé, utilisé pour rapprocher les manga ANN des manga Wikidata
// (ANN ne partage aucun identifiant croisé côté manga).
export function titleKey(title) {
  if (!title) return null;
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
