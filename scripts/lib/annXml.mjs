// Lecture du XML de l'API Encyclopedia d'Anime News Network.
//
// Pas de dépendance externe : le format d'ANN est généré par machine et
// parfaitement régulier (une seule profondeur d'imbrication utile), donc une
// extraction ciblée suffit et évite d'ajouter un parseur XML complet au projet.
//
// Structure type d'une fiche :
//   <anime id="4658" type="TV" name="Jinki:Extend">
//     <info type="Main title" lang="JA">Jinki:Extend</info>
//     <info type="Picture" src="..."><img src="..." width=".." height=".."/></info>
//     <info type="Official website" lang="EN" href="https://...">Libellé</info>
//     <staff><task>Director</task><person id="3610">Masahiko Murata</person></staff>
//     <cast lang="FR"><role>Edward Elric</role><person id="...">Arthur Pestel</person></cast>
//     <ratings nb_votes="435" weighted_score="6.0264"/>
//   </anime>

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(str) {
  if (!str) return "";
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function attrs(tagSource) {
  const out = {};
  for (const m of tagSource.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    out[m[1]] = decodeEntities(m[2]);
  }
  return out;
}

// Retire le balisage résiduel qu'ANN laisse dans certains champs texte
// (le résumé contient parfois des <i>, des <br> ou des liens).
function plainText(html) {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Découpe la réponse en fiches <anime> et <manga>, et parse chacune. */
export function parseAnnResponse(xml) {
  const records = [];
  for (const m of xml.matchAll(/<(anime|manga)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const kind = m[1];
    const head = attrs(m[2]);
    const body = m[3];
    const id = parseInt(head.id, 10);
    if (!Number.isInteger(id)) continue;
    records.push(parseRecord(kind, id, head, body));
  }
  return records;
}

function parseRecord(kind, id, head, body) {
  const rec = {
    kind, // "anime" | "manga"
    ann_id: id,
    name: head.name || null,
    type: head.type || null, // TV, OAV, movie, ONA, special, omnibus…
    precision: head.precision || null,
    titles: {}, // { EN: [...], FR: [...], ... }
    mainTitle: null,
    genres: [],
    themes: [],
    synopsis: null,
    episodes: null,
    vintage: null,
    pictures: [],
    officialSites: [],
    openingThemes: [],
    endingThemes: [],
    copyright: null,
    objectionable: null,
    staff: [],
    cast: [], // [{ role, person, lang }]
    rating: null,
    ratingVotes: null,
  };

  for (const m of body.matchAll(/<info\b([^>]*?)(?:\/>|>([\s\S]*?)<\/info>)/g)) {
    const a = attrs(m[1]);
    const rawInner = m[2] ?? "";
    const value = plainText(rawInner);

    switch (a.type) {
      case "Main title":
        rec.mainTitle = value;
        if (a.lang) (rec.titles[a.lang] ||= []).push(value);
        break;
      case "Alternative title":
        if (a.lang && value) (rec.titles[a.lang] ||= []).push(value);
        break;
      case "Genres":
        if (value) rec.genres.push(value);
        break;
      case "Themes":
        if (value) rec.themes.push(value);
        break;
      case "Plot Summary":
        // Une fiche peut porter plusieurs résumés (par source) : on garde le plus complet.
        if (value && (!rec.synopsis || value.length > rec.synopsis.length)) rec.synopsis = value;
        break;
      case "Number of episodes":
        rec.episodes = parseInt(value, 10) || null;
        break;
      case "Vintage":
        if (!rec.vintage && value) rec.vintage = value;
        break;
      case "Picture": {
        // La plus grande variante disponible est la dernière <img> listée.
        const sizes = [...rawInner.matchAll(/<img\b([^>]*)\/?>/g)].map((im) => attrs(im[1]));
        const best = sizes
          .filter((s) => s.src)
          .sort((x, y) => (parseInt(y.width, 10) || 0) - (parseInt(x.width, 10) || 0))[0];
        if (best?.src) rec.pictures.push(best.src);
        else if (a.src) rec.pictures.push(a.src);
        break;
      }
      case "Official website":
        if (a.href) rec.officialSites.push({ label: value || a.href, url: a.href, lang: a.lang || null });
        break;
      case "Opening Theme":
        if (value) rec.openingThemes.push(value);
        break;
      case "Ending Theme":
        if (value) rec.endingThemes.push(value);
        break;
      case "Copyright notice":
        if (!rec.copyright) rec.copyright = value;
        break;
      case "Objectionable content":
        rec.objectionable = value;
        break;
      default:
        break;
    }
  }

  for (const m of body.matchAll(/<staff\b[^>]*>([\s\S]*?)<\/staff>/g)) {
    const task = plainText((m[1].match(/<task>([\s\S]*?)<\/task>/) || [])[1] || "");
    const person = plainText((m[1].match(/<person\b[^>]*>([\s\S]*?)<\/person>/) || [])[1] || "");
    if (task && person) rec.staff.push({ task, name: person });
  }

  for (const m of body.matchAll(/<cast\b([^>]*)>([\s\S]*?)<\/cast>/g)) {
    const a = attrs(m[1]);
    const role = plainText((m[2].match(/<role>([\s\S]*?)<\/role>/) || [])[1] || "");
    const person = plainText((m[2].match(/<person\b[^>]*>([\s\S]*?)<\/person>/) || [])[1] || "");
    if (role) rec.cast.push({ role, person: person || null, lang: a.lang || null });
  }

  const ratings = body.match(/<ratings\b([^>]*)\/?>/);
  if (ratings) {
    const a = attrs(ratings[1]);
    rec.rating = parseFloat(a.weighted_score) || parseFloat(a.bayesian_score) || null;
    rec.ratingVotes = parseInt(a.nb_votes, 10) || null;
  }

  return rec;
}

/** Liste d'IDs depuis un rapport reports.xml (<item><id>..</id>...</item>). */
export function parseAnnReport(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const id = parseInt((block.match(/<id>(\d+)<\/id>/) || [])[1], 10);
    if (!Number.isInteger(id)) continue;
    items.push({
      ann_id: id,
      type: plainText((block.match(/<type>([\s\S]*?)<\/type>/) || [])[1] || "") || null,
      name: plainText((block.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || "") || null,
      vintage: plainText((block.match(/<vintage>([\s\S]*?)<\/vintage>/) || [])[1] || "") || null,
    });
  }
  return items;
}

/** "2005-01-05 to 2005-03-23" | "2005-01" | "2005" -> { start, end } en dates ISO complètes. */
export function parseVintage(vintage) {
  if (!vintage) return { start: null, end: null };
  const dates = [...vintage.matchAll(/(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/g)].map((m) => {
    const [, y, mo, d] = m;
    return `${y}-${mo || "01"}-${d || "01"}`;
  });
  if (dates.length === 0) return { start: null, end: null };
  return { start: dates[0], end: dates.length > 1 ? dates[dates.length - 1] : null };
}
