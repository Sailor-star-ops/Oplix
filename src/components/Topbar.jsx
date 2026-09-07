import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "../lib/supabase";

const SOON_WINDOW = 7 * 24 * 3600; // au-delà d'une semaine, un compte à rebours n'est plus vraiment actionnable

function formatCountdown(sec) {
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))} min`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h`;
  return `${Math.round(sec / 86400)} j`;
}

/* ─── "À suivre" : ce que l'utilisateur a besoin de voir sans changer
   de page — en priorité un épisode qui sort bientôt parmi ce qu'il
   regarde, sinon une reprise rapide de son visionnage le plus récent.
   Rien à afficher si sa watchlist "en cours" est vide. ─────────────── */
function useNextUp(watchlist) {
  return useMemo(() => {
    const watching = (watchlist || []).filter(
      (w) => w.status === "watching" && w._anime,
    );
    if (watching.length === 0) return null;

    const airingSoon = watching
      .filter((w) => {
        const t = w._anime.nextAiringEpisode?.timeUntilAiring;
        return t != null && t > 0 && t <= SOON_WINDOW;
      })
      .sort(
        (a, b) =>
          a._anime.nextAiringEpisode.timeUntilAiring -
          b._anime.nextAiringEpisode.timeUntilAiring,
      );
    if (airingSoon.length > 0) {
      const item = airingSoon[0];
      return {
        kind: "airing",
        item,
        icon: "fa-satellite-dish",
        label: `${item.title} · Ép ${item._anime.nextAiringEpisode.episode} dans ${formatCountdown(item._anime.nextAiringEpisode.timeUntilAiring)}`,
        urgent: item._anime.nextAiringEpisode.timeUntilAiring <= 2 * 3600,
      };
    }

    const [item] = [...watching].sort(
      (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0),
    );
    return {
      kind: "resume",
      item,
      icon: "fa-play",
      label: `Reprendre ${item.title} · Ép ${item.progress}${item.totalEpisodes ? `/${item.totalEpisodes}` : ""}`,
      urgent: false,
    };
  }, [watchlist]);
}

const TIERS = [
  { min: 0, label: "Nouveau Watcher", color: "#71717a" },
  { min: 10, label: "Initié Otaku", color: "#60a5fa" },
  { min: 30, label: "Watcher Confirmé", color: "#34d399" },
  { min: 60, label: "Watcher Légendaire", color: "#ff5500" },
  { min: 100, label: "Maître des Animés", color: "#fbbf24" },
  { min: 200, label: "Otaku Transcendant", color: "#c084fc" },
];
const getTier = (n) => {
  let t = TIERS[0];
  for (const x of TIERS) {
    if (n >= x.min) t = x;
  }
  return t;
};

function useClickOutside(onOutside) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onOutside]);
  return ref;
}

function Topbar({ user, stats, watchlist, onOpenModal, theme, onToggleTheme }) {
  const [shards, setShards] = useState(0);
  const nextUp = useNextUp(watchlist);
  const [notifOpen, setNotifOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);

  const notifRef = useClickOutside(() => setNotifOpen(false));
  const settingsRef = useClickOutside(() => setSettingsOpen(false));

  useEffect(() => {
    if (!user?.id) {
      setShards(0);
      return;
    }
    supabase
      .from("profiles")
      .select("shards")
      .eq("id", user.id)
      .single()
      .then(({ data }) => setShards(data?.shards || 0));
  }, [user?.id]); // 🔑 Dépendance stricte sur user?.id pour éviter de spammer Supabase

  const tier = getTier(stats?.completed || 0);
  const nextTier = TIERS.find((t) => t.min > (stats?.completed || 0));
  const xpPct = nextTier
    ? Math.min(
        100,
        (((stats?.completed || 0) - tier.min) / (nextTier.min - tier.min)) *
          100,
      )
    : 100;

  return (
    <>
      <div className="tb">
        <div className="tb__left">
          {nextUp && (
            <button
              className={`tb__pill tb__pill--nextup ${nextUp.kind === "airing" ? "tb__pill--nextup-airing" : ""}`}
              onClick={() => onOpenModal?.(nextUp.item._anime)}
              title={nextUp.kind === "airing" ? "Prochain épisode qui sort dans ta liste en cours" : "Reprendre là où tu t'es arrêté"}
            >
              {nextUp.urgent && <span className="tb__pill-dot" />}
              <i className={`fas ${nextUp.icon}`}></i>
              <span className="tb__pill-label">{nextUp.label}</span>
            </button>
          )}
        </div>
        <div className="tb__right">
        {user && (
          <>
            <button
              className="tb__pill tb__pill--shards"
              title="Seishin — monnaie Oplix, gagnée via les quêtes (bientôt). Clique pour voir la boutique."
              onClick={() => setShopOpen(true)}
            >
              <i className="fas fa-ghost"></i>
              <span>{shards}</span>
            </button>

            <div
              className="tb__pill tb__pill--xp"
              style={{ "--tc": tier.color }}
              title={`${tier.label} — ${stats?.completed || 0} animés terminés`}
            >
              <i className="fas fa-bolt"></i>
              <div className="tb__xp-track">
                <div
                  className="tb__xp-fill"
                  style={{ width: `${xpPct}%` }}
                ></div>
              </div>
              <span className="tb__xp-tier">{tier.label}</span>
            </div>
          </>
        )}

        <div className="tb__iconbtn-wrap" ref={notifRef}>
          <button
            className="tb__iconbtn"
            onClick={() => {
              setNotifOpen((o) => !o);
              setSettingsOpen(false);
            }}
          >
            <i className="fas fa-bell"></i>
          </button>
          {notifOpen && (
            <div className="tb__dropdown tb__dropdown--notif">
              <div className="tb__dropdown-head">Notifications</div>
              <div className="tb__dropdown-empty">
                <i className="fas fa-bell-slash"></i>
                <p>Rien pour l'instant.</p>
                <span>
                  Les rappels d'épisodes et de streak arrivent bientôt.
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="tb__iconbtn-wrap" ref={settingsRef}>
          <button
            className="tb__iconbtn"
            onClick={() => {
              setSettingsOpen((o) => !o);
              setNotifOpen(false);
            }}
          >
            <i className="fas fa-gear"></i>
          </button>
          {settingsOpen && (
            <div className="tb__dropdown tb__dropdown--settings">
              <div className="tb__dropdown-head">Paramètres</div>
              <button className="tb__dropdown-item" onClick={onToggleTheme}>
                <i className={`fas ${theme === "dark" ? "fa-sun" : "fa-moon"}`}></i>{" "}
                Thème {theme === "dark" ? "clair" : "sombre"}
              </button>
              {user ? (
                <>
                  <button
                    className="tb__dropdown-item"
                    onClick={() => setSettingsOpen(false)}
                  >
                    <i className="fas fa-user-pen"></i> Modifier mon profil
                  </button>
                  <button
                    className="tb__dropdown-item"
                    onClick={() => {
                      setShopOpen(true);
                      setSettingsOpen(false);
                    }}
                  >
                    <i className="fas fa-store"></i> Boutique
                  </button>
                  <div className="tb__dropdown-item tb__dropdown-item--soon">
                    <i className="fas fa-bell"></i> Préférences de notifications{" "}
                    <span>Bientôt</span>
                  </div>
                </>
              ) : (
                <p
                  className="tb__dropdown-empty"
                  style={{ padding: "16px 18px" }}
                >
                  Connecte-toi pour accéder aux autres paramètres.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      </div>

      {shopOpen && (
        <div className="mi-overlay" onClick={() => setShopOpen(false)}>
          <div
            className="mi"
            style={{ maxWidth: 480, height: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="mi__close" onClick={() => setShopOpen(false)}>
              <i className="fas fa-times" />
            </button>
            <div
              className="mi__body"
              style={{ flexDirection: "column", padding: "36px" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 24,
                }}
              >
                <i
                  className="fas fa-store"
                  style={{ color: "#ff5500", fontSize: "1.3rem" }}
                />
                <h2
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: "1.5rem",
                    color: "white",
                    margin: 0,
                  }}
                >
                  Boutique
                </h2>
              </div>

              <div
                className="tb__pill tb__pill--shards"
                style={{ width: "fit-content", marginBottom: 28 }}
              >
                <i className="fas fa-ghost"></i>
                <span>{shards} Seishin</span>
              </div>

              <div className="empty-state" style={{ padding: "36px 10px" }}>
                <i className="fas fa-wand-magic-sparkles"></i>
                <h3>Bientôt disponible</h3>
                <p>
                  Les premiers objets cosmétiques (bannières, cadres, thèmes
                  de carte membre) arrivent prochainement.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Topbar;
