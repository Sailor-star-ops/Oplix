import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { searchMedia, fetchAllByIds, FORMAT_LABELS } from "../lib/catalog";
import ScrollToTop from "../components/ScrollToTop";

/* ─── L'animé du jour ────────────────────────────────────────────────
   Un animé mystère, le même pour tout le monde, six essais, un indice
   de plus à chaque erreur. Le titre est affiché en cases vides dès le
   départ : c'est le plateau de jeu, et c'est lui qui rend la partie
   jouable — sans lui, six indices sur un catalogue de 35 000 fiches
   laissent le joueur dans le vide.

   Vivier borné par la notoriété, sinon le jeu est impossible. Mesuré le
   2026-09-20 : 528 fiches dépassent 500 000 membres MyAnimeList (mode
   normal, un an et demi de parties), 1 379 dépassent 200 000 (mode
   expert, presque quatre ans). */

const MODES = {
  normal: { seuil: 500000, label: "Grand public" },
  expert: { seuil: 200000, label: "Expert" },
};
const ESSAIS_MAX = 6;

/* Même animé pour tout le monde le même jour, sans rien stocker côté
   serveur : le tirage est dérivé de la date. */
function grainDuJour(texte) {
  let h = 2166136261;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);

/* Le titre à deviner, découpé en cases. Les caractères qui ne sont ni
   lettres ni chiffres (espaces, deux-points, tirets) restent visibles :
   ils donnent la forme du titre sans rien révéler. */
function casesDuTitre(titre) {
  return [...(titre || "")].map((c, i) => ({
    c,
    i,
    devinable: /[\p{L}\p{N}]/u.test(c),
  }));
}

/* Les lettres dévoilées à chaque erreur sont tirées de la même graine que
   l'animé du jour : tout le monde voit exactement les mêmes. */
function ordreDevoilement(titre, graine) {
  const indices = casesDuTitre(titre).filter((x) => x.devinable).map((x) => x.i);
  let g = graine;
  for (let i = indices.length - 1; i > 0; i--) {
    g = (g * 1103515245 + 12345) & 0x7fffffff;
    const j = g % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

function anonymise(texte, titres) {
  if (!texte) return null;
  const mots = titres
    .filter(Boolean)
    .flatMap((t) => t.split(/[^\p{L}\p{N}]+/u))
    .filter((m) => m.length > 3);
  let out = texte.split(/\n/)[0];
  for (const mot of new Set(mots)) out = out.replace(new RegExp(mot, "gi"), "…");
  return out.length > 220 ? out.slice(0, 220) + "…" : out;
}

/* Les indices vont du plus large au plus précis : le premier situe
   l'œuvre, le dernier la désigne presque. */
function construireIndices(a) {
  const perso = (a.characters || [])[0];
  const voixFr = (perso?.actors || []).find((v) => v.lang === "FR");
  const liste = [
    {
      cle: "Format",
      icone: "fa-tv",
      valeur: `${FORMAT_LABELS[a.type] || a.type || "?"}${a.episodes ? ` · ${a.episodes} ép.` : ""}`,
    },
    { cle: "Genres", icone: "fa-tags", valeur: (a.genres || []).slice(0, 3).join(", ") },
    { cle: "Année", icone: "fa-calendar", valeur: a.start_date?.slice(0, 4) },
    { cle: "Studio", icone: "fa-clapperboard", valeur: beauStudio(a.studios) },
  ];
  if (perso) {
    liste.push(
      voixFr
        ? { cle: "Voix française", icone: "fa-microphone", valeur: `${voixFr.name} double ${perso.name}` }
        : { cle: "Personnage", icone: "fa-user", valeur: perso.name },
    );
  }
  const opening = (a.opening_themes || [])[0];
  if (opening) liste.push({ cle: "Générique", icone: "fa-music", valeur: opening });
  const resume = anonymise(a.synopsis, [a.title_romaji, a.title_english, a.title_native]);
  if (resume) liste.push({ cle: "Résumé", icone: "fa-align-left", valeur: resume });
  return liste.filter((i) => i.valeur);
}

/* Le dataset amont liste les studios en minuscules, souvent en double et avec
   la raison sociale ("8 pan", "8pan", "tms entertainment co., ltd."). Pour un
   indice comme pour l'affichage, on prend le nom le plus complet et on lui
   rend une casse présentable. */
const PETITS_MOTS = new Set(["de", "du", "des", "the", "of", "and"]);
function beauStudio(studios) {
  const brut = [...(studios || [])].sort((a, b) => b.length - a.length)[0];
  if (!brut) return null;
  return brut
    .replace(/,?\s*(co\.?,?\s*ltd\.?|inc\.?|ltd\.?)$/i, "")
    .split(" ")
    .map((m, i) => {
      if (i > 0 && PETITS_MOTS.has(m)) return m;
      // Beaucoup de studios sont des sigles : "tms" doit donner TMS, pas Tms.
      if (m.length <= 3 && /^[a-z]+$/.test(m)) return m.toUpperCase();
      return m.charAt(0).toUpperCase() + m.slice(1);
    })
    .join(" ");
}

function comparer(essai, cible) {
  const aE = essai.start_date ? +essai.start_date.slice(0, 4) : null;
  const aC = cible.start_date ? +cible.start_date.slice(0, 4) : null;
  const communs = (essai.genres || []).filter((g) => (cible.genres || []).includes(g));
  const memeStudio = (essai.studios || []).some((s) => (cible.studios || []).includes(s));
  const notes = [];
  if (aE && aC && aE !== aC) notes.push({ t: aE < aC ? "cherche plus récent" : "cherche plus ancien", chaud: false });
  if (aE && aC && aE === aC) notes.push({ t: "bonne année", chaud: true });
  if (memeStudio) notes.push({ t: "même studio", chaud: true });
  if (communs.length) notes.push({ t: `${communs.length} genre${communs.length > 1 ? "s" : ""} en commun`, chaud: communs.length > 1 });
  if (!notes.length) notes.push({ t: "rien en commun", chaud: false });
  return notes;
}

export default function Daily({ user, onOpenModal }) {
  const date = aujourdhui();
  const [mode, setMode] = useState("normal");
  const [cible, setCible] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [essais, setEssais] = useState([]);
  const [saisie, setSaisie] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [copie, setCopie] = useState(false);
  const [serie, setSerie] = useState(0);
  const timer = useRef(null);

  const gagne = essais.some((e) => e.correct);
  const termine = gagne || essais.length >= ESSAIS_MAX;
  const indices = useMemo(() => (cible ? construireIndices(cible) : []), [cible]);
  const devoiles = Math.min(indices.length, 1 + essais.length);

  const titreCible = cible ? cible.title_english || cible.title_romaji : "";
  const graine = grainDuJour(date + mode);
  const revelees = useMemo(() => {
    if (!titreCible) return new Set();
    const ordre = ordreDevoilement(titreCible, graine);
    // Une lettre de plus par erreur : la partie s'éclaire même quand on sèche.
    return new Set(ordre.slice(0, essais.filter((e) => !e.correct).length));
  }, [titreCible, graine, essais]);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    (async () => {
      try {
        const ids = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase
            .from("catalog_anime")
            .select("id")
            .gte("members", MODES[mode].seuil)
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
        const { data, error } = await supabase
          .from("catalog_anime")
          .select("*")
          .eq("id", ids[grainDuJour(date + mode) % ids.length])
          .single();
        if (error) throw error;
        if (!annule) setCible(data);
      } catch (e) {
        if (!annule) setErreur(e.message);
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => { annule = true; };
  }, [date, mode]);

  useEffect(() => {
    try {
      const brut = localStorage.getItem(`oplix-jeu-${mode}-${date}`);
      setEssais(brut ? JSON.parse(brut) : []);
      const s = JSON.parse(localStorage.getItem("oplix-jeu-serie") || "{}");
      setSerie(s.compte || 0);
    } catch { /* stockage indisponible */ }
  }, [date, mode]);

  const cloture = useCallback(
    (liste) => {
      try {
        localStorage.setItem(`oplix-jeu-${mode}-${date}`, JSON.stringify(liste));
        if (liste.some((e) => e.correct)) {
          const s = JSON.parse(localStorage.getItem("oplix-jeu-serie") || "{}");
          const hier = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          if (s.dernier !== date) {
            const compte = s.dernier === hier ? (s.compte || 0) + 1 : 1;
            localStorage.setItem("oplix-jeu-serie", JSON.stringify({ compte, dernier: date }));
            setSerie(compte);
          }
        }
      } catch { /* idem */ }
    },
    [date, mode],
  );

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
      .select("id, start_date, genres, studios")
      .eq("id", media.id)
      .single();
    const correct = media.id === cible.id;
    const suite = [
      ...essais,
      {
        id: media.id,
        titre: media.title?.english || media.title?.romaji || "?",
        annee: media.startDate?.year || null,
        correct,
        notes: correct ? [{ t: "c'est lui", chaud: true }] : data ? comparer(data, cible) : [],
      },
    ];
    setEssais(suite);
    cloture(suite);
  };

  /* La fiche doit être la vraie fiche du catalogue : au premier essai je
     passais un objet bricolé à la modale, qui s'ouvrait donc vide. */
  const ouvrirFiche = async () => {
    const [media] = await fetchAllByIds([cible.id]);
    if (media) onOpenModal?.(media);
  };

  // Dans l'app la grille est dessinée (les emoji carrés rendent mal selon la
  // police) ; le texte copié, lui, doit rester du pur emoji pour survivre au
  // collage dans une story ou une conversation.
  const cases = Array.from({ length: ESSAIS_MAX }, (_, i) =>
    essais[i] ? (essais[i].correct ? "ok" : "ko") : "vide",
  );
  const grilleTexte = cases
    .map((c) => (c === "ok" ? "🟧" : c === "ko" ? "⬛" : "⬜"))
    .join("");

  const partager = async () => {
    const texte =
      `Oplix · l'animé du jour\n${grilleTexte}\n` +
      (gagne ? `trouvé en ${essais.length}/${ESSAIS_MAX}` : `pas trouvé`) +
      (serie > 1 ? ` · série de ${serie} jours` : "") +
      `\noplix.app`;
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(true);
      setTimeout(() => setCopie(false), 2500);
    } catch { /* presse-papier refusé */ }
  };

  if (chargement) {
    return <div className="scroll-area"><div className="jeu-wrap"><div className="jeu-skel" /></div></div>;
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
          <div>
            <h1 className="jeu-title">L&apos;animé du jour</h1>
            <p className="jeu-sub">
              {termine
                ? gagne
                  ? `Trouvé en ${essais.length} essai${essais.length > 1 ? "s" : ""}.`
                  : "Perdu pour aujourd'hui."
                : "Six essais. Une lettre et un indice de plus à chaque erreur."}
            </p>
          </div>
          <div className="jeu-meta">
            {serie > 0 && (
              <span className="jeu-serie" title="Jours d'affilée trouvés">
                <i className="fas fa-fire" /> {serie}
              </span>
            )}
            <div className="jeu-modes">
              {Object.entries(MODES).map(([k, m]) => (
                <button key={k} className={k === mode ? "on" : ""} onClick={() => setMode(k)}>{m.label}</button>
              ))}
            </div>
          </div>
        </header>

        <section className="jeu-plateau">
          <div className="jeu-cases">
            {casesDuTitre(titreCible).map((c) => {
              if (!c.devinable) return <span className="jeu-sep" key={c.i}>{c.c === " " ? "" : c.c}</span>;
              const vue = termine || revelees.has(c.i);
              return (
                <span className={`jeu-case ${vue ? "jeu-case--vue" : ""} ${termine && gagne ? "jeu-case--ok" : ""}`} key={c.i}>
                  {vue ? c.c : ""}
                </span>
              );
            })}
          </div>
          <div className="jeu-points">
            {Array.from({ length: ESSAIS_MAX }).map((_, i) => (
              <span
                key={i}
                className={`jeu-point ${essais[i] ? (essais[i].correct ? "jeu-point--ok" : "jeu-point--ko") : ""}`}
              />
            ))}
          </div>
        </section>

        <section className="jeu-indices">
          {indices.slice(0, devoiles).map((i) => (
            <article className="jeu-indice" key={i.cle}>
              <i className={`fas ${i.icone}`} />
              <div>
                <span className="jeu-k">{i.cle}</span>
                <span className="jeu-v">{i.valeur}</span>
              </div>
            </article>
          ))}
          {indices.length > devoiles && (
            <article className="jeu-indice jeu-indice--lock">
              <i className="fas fa-lock" />
              <div>
                <span className="jeu-k">Indice suivant</span>
                <span className="jeu-v">{indices[devoiles].cle.toLowerCase()} — au prochain essai</span>
              </div>
            </article>
          )}
        </section>

        {!termine && (
          <div className="jeu-search">
            <i className="fas fa-magnifying-glass" />
            <input
              className="jeu-input"
              value={saisie}
              onChange={(e) => chercher(e.target.value)}
              placeholder="Tape un titre…"
              autoFocus
            />
            {suggestions.length > 0 && (
              <ul className="jeu-sugg">
                {suggestions.map((m) => (
                  <li key={m.id}>
                    <button onClick={() => proposer(m)}>
                      {m.coverImage?.medium && <img src={m.coverImage.medium} alt="" loading="lazy" />}
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
                <span className="jeu-titre">
                  {e.titre} {e.annee && <small>{e.annee}</small>}
                </span>
                <span className="jeu-notes">
                  {e.notes.map((n, j) => (
                    <em key={j} className={n.chaud ? "chaud" : ""}>{n.t}</em>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}

        {termine && (
          <section className="jeu-fin">
            {cible.cover_url && <img className="jeu-cover" src={cible.cover_url} alt="" />}
            <div className="jeu-fin-txt">
              <p className="jeu-k">La réponse</p>
              <h2>{titreCible}</h2>
              <p className="jeu-sub">
                {[cible.start_date?.slice(0, 4), beauStudio(cible.studios), (cible.genres || []).slice(0, 2).join(", ")]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="jeu-grille">
                {cases.map((c, i) => (
                  <span key={i} className={`jeu-carre jeu-carre--${c}`} />
                ))}
              </div>
              <div className="jeu-actions">
                <button className="btn btn-primary" onClick={partager}>
                  <i className="fas fa-share-nodes" /> {copie ? "Grille copiée" : "Partager"}
                </button>
                <button className="btn btn-secondary" onClick={ouvrirFiche}>Voir la fiche</button>
              </div>
              <p className="jeu-sub jeu-demain">
                Prochain animé demain{user ? "" : " — crée un compte pour garder ta série"}.
              </p>
            </div>
          </section>
        )}
        <ScrollToTop />
      </div>
    </div>
  );
}
