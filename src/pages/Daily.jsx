import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../lib/supabase";
import { searchMedia, FORMAT_LABELS } from "../lib/catalog";
import ScrollToTop from "../components/ScrollToTop";

/* ─── Le jeu du jour ─────────────────────────────────────────────────
   Un animé mystère, le même pour tout le monde, six essais. Chaque
   mauvaise réponse dévoile un indice de plus. Le résultat se partage
   sous forme de grille, sans jamais révéler le titre.

   Le vivier est borné par la notoriété : sur 35 000 fiches, la plupart
   sont invisibles du grand public et rendraient le jeu impossible.
   Mesuré le 2026-09-20 : 1 379 fiches dépassent 200 000 membres
   MyAnimeList, soit près de quatre ans de parties sans répétition. */

const SEUIL_MEMBRES = 200000;
const ESSAIS_MAX = 6;

/* Le tirage doit donner le même animé à tout le monde le même jour, sans
   rien stocker côté serveur : on dérive un nombre de la date. */
function grainDuJour(dateIso) {
  let h = 2166136261;
  for (let i = 0; i < dateIso.length; i++) {
    h ^= dateIso.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);

/* Le synopsis est le dernier indice : on en retire les noms propres du
   titre, sinon il donne la réponse. */
function anonymise(texte, titres) {
  if (!texte) return null;
  const mots = titres
    .filter(Boolean)
    .flatMap((t) => t.split(/[^\p{L}\p{N}]+/u))
    .filter((m) => m.length > 3);
  let out = texte.split(/\n/)[0];
  for (const mot of new Set(mots)) {
    out = out.replace(new RegExp(mot, "gi"), "…");
  }
  return out.length > 240 ? out.slice(0, 240) + "…" : out;
}

function construireIndices(a) {
  const perso = (a.characters || [])[0];
  const voixFr = (perso?.actors || []).find((v) => v.lang === "FR");
  const indices = [
    { cle: "Format", valeur: `${FORMAT_LABELS[a.type] || a.type || "?"}${a.episodes ? ` · ${a.episodes} épisode${a.episodes > 1 ? "s" : ""}` : ""}` },
    { cle: "Année", valeur: a.start_date ? a.start_date.slice(0, 4) : "inconnue" },
    { cle: "Genres", valeur: (a.genres || []).slice(0, 4).join(", ") || "inconnus" },
    { cle: "Studio", valeur: (a.studios || [])[0] || "inconnu" },
  ];
  if (perso) {
    indices.push({
      cle: voixFr ? "Voix française" : "Personnage",
      valeur: voixFr ? `${voixFr.name} double ${perso.name}` : perso.name,
    });
  }
  const opening = (a.opening_themes || [])[0];
  const synopsis = anonymise(a.synopsis, [a.title_romaji, a.title_english, a.title_native]);
  if (opening) indices.push({ cle: "Générique", valeur: opening });
  else if (synopsis) indices.push({ cle: "Début du résumé", valeur: synopsis });
  return indices.filter((i) => i.valeur && i.valeur !== "inconnue" && i.valeur !== "inconnus");
}

/* Comparaison d'un essai avec la réponse : c'est ce qui rend les mauvaises
   réponses utiles au lieu d'être de simples échecs. */
function comparer(essai, cible) {
  const anneeE = essai.start_date ? +essai.start_date.slice(0, 4) : null;
  const anneeC = cible.start_date ? +cible.start_date.slice(0, 4) : null;
  const communs = (essai.genres || []).filter((g) => (cible.genres || []).includes(g));
  const memeStudio = (essai.studios || []).some((s) => (cible.studios || []).includes(s));
  const notes = [];
  if (anneeE && anneeC && anneeE !== anneeC) {
    // Formulation explicite : « plus récent » tout court laisse le joueur se
    // demander qui est plus récent, son essai ou la réponse.
    notes.push(anneeE < anneeC ? "cherche plus récent" : "cherche plus ancien");
  }
  if (anneeE && anneeC && anneeE === anneeC) notes.push("bonne année");
  if (memeStudio) notes.push("même studio");
  if (communs.length) notes.push(`${communs.length} genre${communs.length > 1 ? "s" : ""} en commun`);
  if (!notes.length) notes.push("rien en commun");
  return notes.join(" · ");
}

export default function Daily({ user, onOpenModal }) {
  const date = aujourdhui();
  const [cible, setCible] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [essais, setEssais] = useState([]);
  const [saisie, setSaisie] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [copie, setCopie] = useState(false);
  const timer = useRef(null);

  const gagne = essais.some((e) => e.correct);
  const termine = gagne || essais.length >= ESSAIS_MAX;
  const indices = useMemo(() => (cible ? construireIndices(cible) : []), [cible]);
  const devoiles = Math.min(indices.length, 1 + essais.length);

  /* Tirage du jour : on ne charge que les identifiants du vivier, puis la
     seule fiche tirée. */
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const ids = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase
            .from("catalog_anime")
            .select("id")
            .gte("members", SEUIL_MEMBRES)
            .in("type", ["TV", "MOVIE", "ONA", "OVA"])
            .not("start_date", "is", null)
            .or("age_rating.is.null,age_rating.neq.rx")
            .not("genres", "ov", "{Hentai,Erotica}")
            .not("tags", "ov", "{hentai,erotica}")
            .order("id")
            .range(from, from + 999);
          if (error) throw error;
          ids.push(...data.map((r) => r.id));
          if (data.length < 1000) break;
        }
        if (!ids.length) throw new Error("vivier vide");
        const choisi = ids[grainDuJour(date) % ids.length];
        const { data, error } = await supabase.from("catalog_anime").select("*").eq("id", choisi).single();
        if (error) throw error;
        if (!annule) setCible(data);
      } catch (e) {
        if (!annule) setErreur(e.message);
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => {
      annule = true;
    };
  }, [date]);

  /* Partie en cours conservée localement : on ne doit pas pouvoir recommencer
     la journée en rechargeant la page. */
  useEffect(() => {
    try {
      const brut = localStorage.getItem(`oplix-jeu-${date}`);
      if (brut) setEssais(JSON.parse(brut));
    } catch { /* stockage indisponible : on joue sans mémoire */ }
  }, [date]);

  useEffect(() => {
    if (!essais.length) return;
    try {
      localStorage.setItem(`oplix-jeu-${date}`, JSON.stringify(essais));
    } catch { /* idem */ }
  }, [essais, date]);

  const chercher = (texte) => {
    setSaisie(texte);
    clearTimeout(timer.current);
    if (texte.trim().length < 2) return setSuggestions([]);
    timer.current = setTimeout(async () => {
      try {
        const { media } = await searchMedia({ search: texte, type: "ANIME", perPage: 6 });
        setSuggestions(media);
      } catch { setSuggestions([]); }
    }, 250);
  };

  const proposer = async (media) => {
    if (termine || !cible) return;
    setSaisie("");
    setSuggestions([]);
    const { data } = await supabase
      .from("catalog_anime")
      .select("id, title_romaji, title_english, start_date, genres, studios")
      .eq("id", media.id)
      .single();
    const correct = media.id === cible.id;
    setEssais((prev) => [
      ...prev,
      {
        id: media.id,
        titre: media.title?.english || media.title?.romaji || "?",
        correct,
        detail: correct ? "c'est lui" : data ? comparer(data, cible) : "",
      },
    ]);
  };

  const grille = essais.map((e) => (e.correct ? "🟩" : "🟥")).join("") +
    "⬜".repeat(Math.max(0, ESSAIS_MAX - essais.length));

  const partager = async () => {
    const texte = `Oplix — l'animé du jour\n${grille}\n${gagne ? `trouvé en ${essais.length}` : "pas trouvé"}\noplix.app`;
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(true);
      setTimeout(() => setCopie(false), 2500);
    } catch { /* presse-papier refusé */ }
  };

  if (chargement) {
    return (
      <div className="scroll-area">
        <div className="jeu-wrap"><div className="jeu-skel" /></div>
      </div>
    );
  }
  if (erreur) {
    return (
      <div className="scroll-area">
        <div className="jeu-wrap"><p className="jeu-sub">Impossible de charger la partie du jour ({erreur}).</p></div>
      </div>
    );
  }

  return (
    <div className="scroll-area">
      <div className="jeu-wrap">
        <header className="jeu-head">
          <h1 className="jeu-title">L&apos;animé du jour</h1>
          <p className="jeu-sub">
            {termine
              ? gagne
                ? `Trouvé en ${essais.length} essai${essais.length > 1 ? "s" : ""}.`
                : "Perdu pour aujourd'hui."
              : `Essai ${essais.length + 1} sur ${ESSAIS_MAX} · un indice de plus à chaque erreur`}
          </p>
        </header>

        <section className="jeu-card">
          {indices.slice(0, devoiles).map((i) => (
            <div className="jeu-row" key={i.cle}>
              <span className="jeu-k">{i.cle}</span>
              <span className="jeu-v">{i.valeur}</span>
            </div>
          ))}
          {indices.slice(devoiles).map((i) => (
            <div className="jeu-row jeu-row--locked" key={i.cle}>
              <span className="jeu-k">{i.cle}</span>
              <span className="jeu-v">se dévoile à l&apos;essai {indices.indexOf(i) + 1}</span>
            </div>
          ))}
        </section>

        {!termine && (
          <div className="jeu-search">
            <input
              className="jeu-input"
              value={saisie}
              onChange={(e) => chercher(e.target.value)}
              placeholder="Ton essai… (tape un titre)"
              autoFocus
            />
            {suggestions.length > 0 && (
              <ul className="jeu-sugg">
                {suggestions.map((m) => (
                  <li key={m.id}>
                    <button onClick={() => proposer(m)}>
                      <span>{m.title?.english || m.title?.romaji}</span>
                      <small>{m.startDate?.year || ""}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {essais.length > 0 && (
          <ul className="jeu-essais">
            {essais.map((e, i) => (
              <li key={i} className={e.correct ? "jeu-ok" : ""}>
                <span className="jeu-num">{i + 1}</span>
                <span className="jeu-titre">{e.titre}</span>
                <span className="jeu-detail">{e.detail}</span>
              </li>
            ))}
          </ul>
        )}

        {termine && (
          <section className="jeu-fin">
            <p className="jeu-grille">{grille}</p>
            <p className="jeu-reponse">
              C&apos;était <strong>{cible.title_english || cible.title_romaji}</strong>
              {cible.start_date ? ` (${cible.start_date.slice(0, 4)})` : ""}.
            </p>
            <div className="jeu-actions">
              <button className="btn btn-primary" onClick={partager}>
                {copie ? "Grille copiée" : "Partager ma grille"}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() =>
                  onOpenModal?.({
                    id: cible.id,
                    title: { english: cible.title_english, romaji: cible.title_romaji },
                    coverImage: { large: cible.cover_url },
                    format: cible.type,
                  })
                }
              >
                Voir la fiche
              </button>
            </div>
            <p className="jeu-sub jeu-demain">Prochain animé demain{user ? "" : " — crée un compte pour garder ta série"}.</p>
          </section>
        )}
        <ScrollToTop />
      </div>
    </div>
  );
}
