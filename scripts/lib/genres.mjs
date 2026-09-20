// Normalisation des genres du catalogue.
//
// Trois sources écrivent la même colonne avec trois conventions : MyAnimeList
// ("Slice of Life"), anime-offline-database (même casse) et Anime News Network
// (tout en minuscules). Résultat mesuré le 2026-09-20 : "Comedy" sur 7 588
// fiches et "comedy" sur 1 084 autres, "Sci-Fi" et "science fiction" côte à
// côte. Les filtres par genre de l'app comparent des chaînes exactes : toutes
// les fiches venues d'ANN étaient donc invisibles au filtrage.

// ANN nomme certains genres autrement que MyAnimeList ; on aligne sur MAL,
// vocabulaire de GENRES_ANIME / GENRES_MANGA dans src/lib/catalog.js.
const ALIASES = new Map([
  ["science fiction", "Sci-Fi"],
  ["sci fi", "Sci-Fi"],
  ["sf", "Sci-Fi"],
]);

// Wikidata range des listes éditoriales dans la propriété "genre" : ce n'est
// pas un genre, ça n'a rien à faire dans un filtre.
const JUNK = new Set(["Eligible Titles for You Should Read This"]);

// Mots que l'usage laisse en minuscules au milieu d'un titre de genre.
const SMALL_WORDS = new Set(["of", "the", "and", "a", "to", "in"]);

function titleCase(value) {
  return value
    .split(" ")
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

export function normalizeGenre(genre) {
  const trimmed = (genre || "").trim();
  if (!trimmed || JUNK.has(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (ALIASES.has(lower)) return ALIASES.get(lower);
  // Une casse déjà mixte vient de MAL ou du dataset : on n'y touche pas.
  if (trimmed !== lower) return trimmed;
  return titleCase(lower);
}

export function normalizeGenres(genres) {
  return [...new Set((genres || []).map(normalizeGenre).filter(Boolean))];
}
