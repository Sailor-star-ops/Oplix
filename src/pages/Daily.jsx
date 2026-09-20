import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { fetchAllByIds, FORMAT_LABELS } from "../lib/catalog";
import ScrollToTop from "../components/ScrollToTop";
import Confettis from "../components/Confettis";

/* ─── L'animé du jour ────────────────────────────────────────────────
   Un animé mystère, le même pour tout le monde, six essais, un indice et
   une lettre de plus à chaque erreur.

   Tout ce qui est tiré au sort vient d'une graine dérivée de la date :
   l'animé du jour, mais aussi l'ordre dans lequel les lettres se
   dévoilent. Deux joueurs voient donc exactement la même partie, personne
   n'est avantagé.

   Vivier borné par la notoriété, sinon la partie est impossible : 528
   fiches dépassent 500 000 membres MyAnimeList (mode grand public),
   1 379 dépassent 200 000 (mode expert). */

const MODES = {
  normal: { seuil: 500000, label: "Grand public" },
  expert: { seuil: 200000, label: "Expert" },
};
const ESSAIS_MAX = 6;

function grainDuJour(texte) {
  let h = 2166136261;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);

/* Forme comparable d'un titre : sans accents, sans ponctuation, sans
   espaces. C'est ce qui fait que « rezero », « Re:ZERO » et « re zero »
   désignent la même œuvre — sinon il faudrait taper au caractère près, et
   personne ne devine qu'il y a deux points dans Re:ZERO. */
function normaliser(texte) {
  return (texte || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function casesDuTitre(titre) {
  return [...(titre || "")].map((c, i) => ({ c, i, devinable: /[\p{L}\p{N}]/u.test(c) }));
}

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
  const mots = titres.filter(Boolean).flatMap((t) => t.split(/[^\p{L}\p{N}]+/u)).filter((m) => m.length > 3);
  let out = texte.split(/\n/)[0];
  for (const mot of new Set(mots)) out = out.replace(new RegExp(mot, "gi"), "…");
  return out.length > 220 ? out.slice(0, 220) + "…" : out;
}

const PETITS_MOTS = new Set(["de", "du", "des", "the", "of", "and"]);
/* Les studios arrivent en minuscules, en double et avec la raison sociale
   (« 8 pan », « 8pan », « tms entertainment co., ltd. »). */
function beauStudio(studios) {
  const brut = [...(studios || [])].sort((a, b) => b.length - a.length)[0];
  if (!brut) return null;
  return brut
    .replace(/,?\s*(co\.?,?\s*ltd\.?|inc\.?|ltd\.?)$/i, "")
    .split(" ")
    .map((m, i) => {
      if (i > 0 && PETITS_MOTS.has(m)) return m;
      if (m.length <= 3 && /^[a-z]+$/.test(m)) return m.toUpperCase();
      return m.charAt(0).toUpperCase() + m.slice(1);
    })
    .join(" ");
}

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

function tempsRestant() {
  const minuit = new Date();
  minuit.setHours(24, 0, 0, 0);
  const s = Math.max(0, Math.floor((minuit - Date.now()) / 1000));
  const d = (n) => String(n).padStart(2, "0");
  return `${d(Math.floor(s / 3600))}:${d(Math.floor((s % 3600) / 60))}:${d(s % 60)}`;
}

export default function Daily({ user, onOpenModal }) {
  const date = aujourdhui();
  const [mode, setMode] = useState("normal");
  const [pool, setPool] = useState([]);
  const [cible, setCible] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [essais, setEssais] = useState([]);
  const [saisie, setSaisie] = useState("");
  const [copie, setCopie] = useState(false);
  const [serie, setSerie] = useState(0);
  const [secousse, setSecousse] = useState(false);
  const [fete, setFete] = useState(false);
  const [compteur, setCompteur] = useState(tempsRestant());
  const [stats, setStats] = useState(null);
  const [cercle, setCercle] = useState([]);
  const [classement, setClassement] = useState([]);
  const enregistre = useRef(false);

  const gagne = essais.some((e) => e.correct);
  const termine = gagne || essais.length >= ESSAIS_MAX;
  const indices = useMemo(() => (cible ? construireIndices(cible) : []), [cible]);
  const devoiles = Math.min(indices.length, 1 + essais.length);
  const titreCible = cible ? cible.title_english || cible.title_romaji : "";

  const revelees = useMemo(() => {
    if (!titreCible) return new Set();
    const ordre = ordreDevoilement(titreCible, grainDuJour(date + mode));
    return new Set(ordre.slice(0, essais.filter((e) => !e.correct).length));
  }, [titreCible, date, mode, essais]);

  useEffect(() => {
    const t = setInterval(() => setCompteur(tempsRestant()), 1000);
    return () => clearInterval(t);
  }, []);

  /* Le vivier entier est chargé une fois : il sert à tirer l'animé du jour
     ET à proposer les titres pendant la saisie, sans aller-retour réseau. */
  useEffect(() => {
    let annule = false;
    setChargement(true);
    setCible(null);
    (async () => {
      try {
        const lignes = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase
            .from("catalog_anime")
            .select("id, title_romaji, title_english, title_native, synonyms, start_date, cover_url")
            .gte("members", MODES[mode].seuil)
            .in("type", ["TV", "MOVIE", "ONA", "OVA"])
            .not("start_date", "is", null)
            .or("age_rating.is.null,age_rating.neq.rx")
            .not("genres", "ov", "{Hentai,Erotica}")
            .not("tags", "ov", "{hentai,erotica}")
            .order("id")
            .range(from, from + 999);
          if (error) throw error;
          lignes.push(...data);
          if (data.length < 1000) break;
        }
        if (!lignes.length) throw new Error("vivier vide");
        const index = lignes.map((l) => ({
          id: l.id,
          titre: l.title_english || l.title_romaji,
          annee: l.start_date?.slice(0, 4),
          cover: l.cover_url,
          cles: [...new Set(
            [l.title_romaji, l.title_english, l.title_native, ...(l.synonyms || [])].map(normaliser).filter(Boolean),
          )],
        }));
        const choisi = lignes[grainDuJour(date + mode) % lignes.length];
        const { data, error } = await supabase.from("catalog_anime").select("*").eq("id", choisi.id).single();
        if (error) throw error;
        if (annule) return;
        setPool(index);
        setCible(data);
      } catch (e) {
        if (!annule) setErreur(e.message);
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => { annule = true; };
  }, [date, mode]);

  useEffect(() => {
    enregistre.current = false;
    setStats(null);
    setCercle([]);
    setClassement([]);
    try {
      const brut = localStorage.getItem(`oplix-jeu-${mode}-${date}`);
      setEssais(brut ? JSON.parse(brut) : []);
      setSerie(JSON.parse(localStorage.getItem("oplix-jeu-serie") || "{}").compte || 0);
    } catch { /* stockage indisponible */ }
  }, [date, mode]);

  /* Suggestions locales : comparaison sur la forme normalisée des titres,
     donc insensible aux accents, à la ponctuation et aux espaces. */
  const suggestions = useMemo(() => {
    const q = normaliser(saisie);
    if (q.length < 2 || termine) return [];
    const deja = new Set(essais.map((e) => e.id));
    const debut = [];
    const dedans = [];
    for (const item of pool) {
      if (deja.has(item.id)) continue;
      let meilleure = Infinity;
      for (const c of item.cles) {
        const i = c.indexOf(q);
        if (i !== -1 && i < meilleure) meilleure = i;
      }
      if (meilleure === 0) debut.push(item);
      else if (meilleure !== Infinity) dedans.push(item);
    }
    return [...debut, ...dedans].slice(0, 8);
  }, [saisie, pool, essais, termine]);

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

  const proposer = async (item) => {
    if (termine || !cible) return;
    setSaisie("");
    const correct = item.id === cible.id;
    if (correct) {
      setFete(true);
      setTimeout(() => setFete(false), 3000);
    } else {
      setSecousse(true);
      setTimeout(() => setSecousse(false), 450);
    }
    const { data } = await supabase
      .from("catalog_anime")
      .select("id, start_date, genres, studios")
      .eq("id", item.id)
      .single();
    const suite = [
      ...essais,
      {
        id: item.id,
        titre: item.titre,
        annee: item.annee,
        cover: item.cover,
        correct,
        notes: correct ? [{ t: "c'est lui", chaud: true }] : data ? comparer(data, cible) : [],
      },
    ];
    setEssais(suite);
    cloture(suite);
  };

  const ouvrirFiche = async () => {
    const [media] = await fetchAllByIds([cible.id]);
    if (media) onOpenModal?.(media);
  };

  const cases = Array.from({ length: ESSAIS_MAX }, (_, i) => (essais[i] ? (essais[i].correct ? "ok" : "ko") : "vide"));
  const grilleTexte = cases.map((c) => (c === "ok" ? "🟧" : c === "ko" ? "⬛" : "⬜")).join("");

  const partager = async () => {
    const texte =
      `Oplix · l'animé du jour${mode === "expert" ? " (expert)" : ""}\n${grilleTexte}\n` +
      (gagne ? `trouvé en ${essais.length}/${ESSAIS_MAX}` : "pas trouvé") +
      (serie > 1 ? ` · série de ${serie} jours` : "");
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(true);
      setTimeout(() => setCopie(false), 2500);
    } catch { /* presse-papier refusé */ }
  };

  /* Fin de partie : on enregistre le résultat — rien d'autre qu'un nombre
     d'essais, donc rien à modérer — puis on va chercher de quoi se
     comparer aux autres. */
  useEffect(() => {
    if (!termine || !cible || enregistre.current) return;
    enregistre.current = true;
    (async () => {
      try {
        if (user) {
          await supabase
            .from("daily_results")
            .insert({ user_id: user.id, jour: date, mode, essais: Math.max(1, essais.length), trouve: gagne });
        }
        const { data: s } = await supabase
          .from("daily_stats")
          .select("joueurs, trouveurs, essais_moyens, meilleur")
          .eq("jour", date)
          .eq("mode", mode)
          .maybeSingle();
        setStats(s || null);

        if (!user) return;
        const { data: suivis } = await supabase.from("follows").select("followed_id").eq("follower_id", user.id);
        const ids = (suivis || []).map((f) => f.followed_id);
        if (ids.length) {
          const [{ data: resultats }, { data: profils }] = await Promise.all([
            supabase.from("daily_results").select("user_id, essais, trouve").eq("jour", date).eq("mode", mode).in("user_id", ids),
            supabase.from("profiles").select("id, username, avatar_url").in("id", ids),
          ]);
          const parId = new Map((profils || []).map((p) => [p.id, p]));
          setCercle(
            (resultats || [])
              .map((r) => ({ ...r, profil: parId.get(r.user_id) }))
              .sort((a, b) => Number(b.trouve) - Number(a.trouve) || a.essais - b.essais),
          );
        }
        const { data: top } = await supabase
          .from("daily_classement")
          .select("user_id, points, victoires, parties, essais_moyens")
          .eq("mode", mode)
          .order("points", { ascending: false })
          .limit(10);
        if (top?.length) {
          const { data: profils } = await supabase.from("profiles").select("id, username").in("id", top.map((t) => t.user_id));
          const parId = new Map((profils || []).map((p) => [p.id, p]));
          setClassement(top.map((t) => ({ ...t, nom: parId.get(t.user_id)?.username || "Joueur" })));
        }
      } catch (e) {
        // Les classements sont un bonus : une table absente ne doit jamais
        // empêcher de jouer.
        console.warn("Classements indisponibles :", e.message);
      }
    })();
  }, [termine, cible, user, date, mode, essais.length, gagne]);

  if (chargement) return <div className="scroll-area"><div className="jeu-wrap"><div className="jeu-skel" /></div></div>;
  if (erreur) {
    return (
      <div className="scroll-area">
        <div className="jeu-wrap"><p className="jeu-sub">Impossible de charger la partie du jour ({erreur}).</p></div>
      </div>
    );
  }

  return (
    <div className="scroll-area">
      {fete && <Confettis />}
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
            {serie > 0 && <span className="jeu-serie"><i className="fas fa-fire" /> {serie}</span>}
            <div className="jeu-modes">
              {Object.entries(MODES).map(([k, m]) => (
                <button key={k} className={k === mode ? "on" : ""} onClick={() => setMode(k)}>{m.label}</button>
              ))}
            </div>
          </div>
        </header>

        <section className={`jeu-plateau${secousse ? " jeu-secousse" : ""}${termine && gagne ? " jeu-plateau--gagne" : ""}`}>
          <div className="jeu-cases">
            {casesDuTitre(titreCible).map((c, n) => {
              if (!c.devinable) return <span className="jeu-sep" key={c.i}>{c.c === " " ? "" : c.c}</span>;
              const vue = termine || revelees.has(c.i);
              return (
                <span
                  key={c.i}
                  style={{ animationDelay: `${(n % 16) * 50}ms` }}
                  className={`jeu-case${vue ? " jeu-case--vue" : ""}${termine && gagne ? " jeu-case--ok" : ""}`}
                >
                  {vue ? c.c : ""}
                </span>
              );
            })}
          </div>
          <div className="jeu-points">
            {cases.map((c, i) => <span key={i} className={`jeu-point jeu-point--${c}`} />)}
          </div>
        </section>

        <section className="jeu-indices">
          {indices.slice(0, devoiles).map((i, n) => (
            <article className="jeu-indice" key={i.cle} style={{ animationDelay: `${n * 60}ms` }}>
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
          <form
            className="jeu-search"
            onSubmit={(e) => {
              // Un vrai formulaire plutôt qu'un écouteur de touche : la
              // validation au clavier marche alors aussi quand le focus est
              // ailleurs dans le champ, et sur mobile le clavier affiche
              // « Entrée » au lieu de « Suivant ».
              e.preventDefault();
              if (suggestions[0]) proposer(suggestions[0]);
            }}
          >
            <i className="fas fa-magnifying-glass" />
            <input
              className="jeu-input"
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              placeholder="Tape un titre — accents et ponctuation sans importance"
              autoFocus
            />
            {suggestions.length > 0 && (
              <ul className="jeu-sugg">
                {suggestions.map((m) => (
                  <li key={m.id}>
                    <button onClick={() => proposer(m)}>
                      {m.cover && <img src={m.cover} alt="" loading="lazy" />}
                      <span>{m.titre}</span>
                      <small>{m.annee}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {saisie.trim().length >= 2 && suggestions.length === 0 && (
              <p className="jeu-vide">
                Aucun titre ne correspond — les réponses possibles sont les {pool.length} animés les plus connus.
              </p>
            )}
          </form>
        )}

        {essais.length > 0 && (
          <ul className="jeu-essais">
            {essais.map((e, i) => (
              <li key={i} className={e.correct ? "jeu-ok" : ""} style={{ animationDelay: `${i * 40}ms` }}>
                {e.cover && <img className="jeu-mini" src={e.cover} alt="" loading="lazy" />}
                <span className="jeu-titre">{e.titre} {e.annee && <small>{e.annee}</small>}</span>
                <span className="jeu-notes">
                  {e.notes.map((n, j) => <em key={j} className={n.chaud ? "chaud" : ""}>{n.t}</em>)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {termine && (
          <>
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
                    <span key={i} className={`jeu-carre jeu-carre--${c}`} style={{ animationDelay: `${i * 70}ms` }} />
                  ))}
                </div>
                <div className="jeu-actions">
                  <button className="btn btn-primary" onClick={partager}>
                    <i className="fas fa-share-nodes" /> {copie ? "Grille copiée" : "Partager"}
                  </button>
                  <button className="btn btn-secondary" onClick={ouvrirFiche}>Voir la fiche</button>
                </div>
                <p className="jeu-sub jeu-demain">
                  <i className="fas fa-hourglass-half" /> Prochain animé dans {compteur}
                  {!user && " — crée un compte pour garder ta série et entrer au classement"}
                </p>
              </div>
            </section>

            <section className="jeu-bloc">
              <h3><i className="fas fa-globe" /> Aujourd&apos;hui dans le monde</h3>
              {stats?.joueurs ? (
                <div className="jeu-chiffres">
                  <div><strong>{stats.joueurs}</strong><span>joueurs</span></div>
                  <div><strong>{Math.round((stats.trouveurs / Math.max(1, stats.joueurs)) * 100)} %</strong><span>ont trouvé</span></div>
                  <div><strong>{stats.essais_moyens ?? "—"}</strong><span>essais en moyenne</span></div>
                  <div><strong>{stats.meilleur ?? "—"}</strong><span>meilleur score</span></div>
                </div>
              ) : (
                <p className="jeu-sub">
                  Personne d&apos;autre n&apos;a encore joué aujourd&apos;hui
                  {user ? "." : " — connecte-toi pour compter dans les statistiques."}
                </p>
              )}
            </section>

            {cercle.length > 0 && (
              <section className="jeu-bloc">
                <h3><i className="fas fa-user-group" /> Tes abonnements aujourd&apos;hui</h3>
                <ul className="jeu-cercle">
                  {cercle.map((r) => (
                    <li key={r.user_id}>
                      <span className="jeu-avatar">
                        {r.profil?.avatar_url ? <img src={r.profil.avatar_url} alt="" /> : <i className="fas fa-user" />}
                      </span>
                      <span className="jeu-nom">{r.profil?.username || "Joueur"}</span>
                      <span className={`jeu-score${r.trouve ? " ok" : ""}`}>{r.trouve ? `${r.essais}/${ESSAIS_MAX}` : "échoué"}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {classement.length > 0 && (
              <section className="jeu-bloc">
                <h3><i className="fas fa-ranking-star" /> Classement sur 30 jours</h3>
                <ul className="jeu-classement">
                  {classement.map((c, i) => (
                    <li key={c.user_id} className={user && c.user_id === user.id ? "moi" : ""}>
                      <span className="jeu-rang">{i + 1}</span>
                      <span className="jeu-nom">{c.nom}</span>
                      <span className="jeu-sub">{c.victoires}/{c.parties} · {c.essais_moyens ?? "—"} essais</span>
                      <strong>{c.points} pts</strong>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        <ScrollToTop />
      </div>
    </div>
  );
}
