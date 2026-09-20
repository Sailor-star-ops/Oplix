import { useState, useEffect, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import Home from "./pages/Home";
import AnimeWheel from "./components/Animewheel";
import Player from "./components/Player";
import Auth from "./components/Auth";
import Explorer from "./pages/Explorer";
import Calendar from "./pages/Calendar";
import Collection from "./pages/Collection";
import Profile from "./pages/Profile";
import PublicCollection from "./pages/Publiccollection";
import PublicProfile from "./pages/Publicprofile";
import Social from "./pages/Social";
import Daily from "./pages/Daily";
import ErrorBoundary from "./components/ErrorBoundary";
import { supabase } from "./lib/supabase";
import { fetchAllByIds, calcStats } from "./lib/catalog";
import "./App.css";

const SOCIAL_TABS = ["social"];

/* ─── Streak hebdo : "à jour" si tous les épisodes sortis sont vus ─── */
function isCaughtUpOnAiring(watchlist) {
  const airing = watchlist.filter(
    (w) => w.status === "watching" && w._anime?.nextAiringEpisode,
  );
  return airing.every(
    (w) => w.progress >= w._anime.nextAiringEpisode.episode - 1,
  );
}

/* Index de semaine (lundi comme premier jour), monotone sur les années
   pour permettre un simple soustraction plutôt qu'un parsing de clé ISO. */
function weekIndex(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return Math.floor(d.getTime() / (7 * 86400000));
}

function App() {
  const [shareCode] = useState(() =>
    new URLSearchParams(window.location.search).get("c"),
  );
  const [profileCode] = useState(() =>
    new URLSearchParams(window.location.search).get("p"),
  );
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState("home");
  const [user, setUser] = useState(null);
  const [watchlist, setWatchlist] = useState([]);
  const [stats, setStats] = useState({
    watching: 0,
    completed: 0,
    plan_to_watch: 0,
    dropped: 0,
    episodes: 0,
    hours: 0,
    total: 0,
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAnime, setSelectedAnime] = useState(null);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerAnime, setPlayerAnime] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("oplix-theme") || "dark",
  );

  /* ─── Thème clair/sombre : préférence locale à l'appareil,
     indépendante du compte (accessible même sans être connecté) ─── */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("oplix-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  /* ─── Charger la watchlist complète ──────────────────────────── */
  const loadWatchlist = useCallback(async (currentUser) => {
    if (!currentUser) return;
    try {
      const { data: rows, error } = await supabase
        .from("watchlist")
        .select("*")
        .eq("user_id", currentUser.id);
      if (error) throw error;
      if (!rows || rows.length === 0) {
        setWatchlist([]);
        setStats({
          watching: 0,
          completed: 0,
          plan_to_watch: 0,
          dropped: 0,
          episodes: 0,
          hours: 0,
          total: 0,
        });
        return;
      }

      const ids = rows.map((r) => r.anilist_id);
      const medias = await fetchAllByIds(ids);

      const list = rows.map((row) => {
        const m = medias.find((x) => x.id === row.anilist_id);
        const totalEps = m?.episodes || m?.chapters || 0;
        const progress = row.progress || 0;
        return {
          id: row.id,
          anilist_id: row.anilist_id,
          // Une entree peut pointer vers une oeuvre absente du catalogue
          // (identifiant AniList d'origine que nos sources ne connaissent pas).
          // On garde la ligne — c'est la liste de l'utilisateur — mais on la
          // signale au lieu d'afficher une carte vide intitulee "Inconnu".
          _missing: !m,
          title: m ? m.title?.english || m.title?.romaji : "Fiche indisponible",
          image: m?.coverImage?.extraLarge || m?.coverImage?.large || "",
          color: m?.coverImage?.color || null,
          format: m?.format || "",
          type: m?.type || "ANIME",
          progress,
          totalEpisodes: totalEps,
          percentage:
            totalEps > 0 ? Math.min(100, (progress / totalEps) * 100) : 0,
          status: row.status || "watching",
          userRating: row.rating || null,
          addedAt: row.created_at || null,
          updatedAt: row.updated_at || null,
          _anime: m || null,
        };
      });

      setWatchlist(list);
      setStats(calcStats(list));
    } catch (e) {
      console.error("loadWatchlist error:", e);
    }
  }, []);

  /* ─── Charger le profil utilisateur (Corrigé pour éviter les boucles) ─── */
  useEffect(() => {
    if (!user?.id) {
      setProfile(null);
      return;
    }

    supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error("Erreur chargement profil:", error.message);
        }
        if (data) {
          setProfile(data);
        }
      });
  }, [user?.id]);

  /* ─── Auth ────────────────────────────────────────────────────── */
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        loadWatchlist(session.user);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        loadWatchlist(session.user);
      } else {
        setUser(null);
        setWatchlist([]);
        setProfile(null);
        setStats({
          watching: 0,
          completed: 0,
          plan_to_watch: 0,
          dropped: 0,
          episodes: 0,
          hours: 0,
          total: 0,
        });
      }
    });
    return () => subscription.unsubscribe();
  }, [loadWatchlist]);

  /* ─── Handlers navigation ─────────────────────────────────────── */
  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  /* Les listes ne chargent qu'un jeu de colonnes réduit (voir LIST_COLS dans
     catalog.js) : personnages, équipe, titres multilingues et liens officiels
     n'y sont pas. La fiche détaillée les recharge donc à l'ouverture — sans
     ça elle s'affiche à moitié vide, ce qui arrivait aussi quand une page lui
     passait un objet bricolé à la main (Collection, jeu du jour). */
  const handleOpenModal = async (anime) => {
    setSelectedAnime(anime);
    setModalOpen(true);
    if (!anime?.id) return;
    try {
      const [complet] = await fetchAllByIds([anime.id]);
      if (complet) setSelectedAnime((actuel) => (actuel?.id === complet.id ? complet : actuel));
    } catch (e) {
      console.error("Chargement de la fiche complète impossible :", e);
    }
  };

  /* ─── Fil d'activité : événements structurés, jamais de texte libre ─── */
  const logActivity = useCallback(
    async (type, { anilist_id, anime_title, anime_image, payload = {} }) => {
      if (!user) return;
      try {
        await supabase.from("activity_events").insert({
          user_id: user.id,
          type,
          anilist_id,
          anime_title,
          anime_image,
          payload,
        });
      } catch (e) {
        console.error("logActivity error:", e);
      }
    },
    [user],
  );

  /* ─── Streak hebdo : recalculé au plus une fois par session ─────── */
  useEffect(() => {
    if (!user?.id || !profile || watchlist.length === 0) return;
    const now = new Date();
    const currentWeek = weekIndex(now);
    const lastWeek = profile.weekly_streak_updated_at
      ? weekIndex(new Date(profile.weekly_streak_updated_at))
      : null;
    if (lastWeek === currentWeek) return;

    const caughtUp = isCaughtUpOnAiring(watchlist);
    const gap = lastWeek === null ? 1 : currentWeek - lastWeek;
    let nextCount;
    if (gap === 1) {
      nextCount = caughtUp ? (profile.weekly_streak_count || 0) + 1 : 0;
    } else {
      nextCount = caughtUp ? 1 : 0;
    }

    supabase
      .from("profiles")
      .update({
        weekly_streak_count: nextCount,
        weekly_streak_updated_at: now.toISOString(),
      })
      .eq("id", user.id)
      .select()
      .single()
      .then(({ data, error }) => {
        if (!error && data) setProfile((p) => ({ ...p, ...data }));
      });
    // Recalcul volontairement limité à une fois par changement de semaine —
    // pas de cron serveur, donc une semaine sautée n'est vue qu'à la
    // prochaine ouverture de l'app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, profile?.id, watchlist.length]);

  /* ─── Watchlist helpers ───────────────────────────────────────── */
  const getItemStatus = (id) =>
    watchlist.find((w) => w.anilist_id === id)?.status || null;
  const getItemRating = (id) =>
    watchlist.find((w) => w.anilist_id === id)?.userRating || 0;
  const getItemProgress = (id) =>
    watchlist.find((w) => w.anilist_id === id)?.progress || 0;

  const handleAddToList = async (anime, status) => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    const previousStatus = watchlist.find((w) => w.anilist_id === anime.id)?.status;
    try {
      const { data, error } = await supabase
        .from("watchlist")
        .upsert(
          { anilist_id: anime.id, user_id: user.id, status, progress: 0 },
          { onConflict: "user_id,anilist_id" },
        )
        .select()
        .single();
      if (error) throw error;

      if (status !== previousStatus && (status === "completed" || status === "watching")) {
        logActivity(status === "completed" ? "completed" : "started_watching", {
          anilist_id: anime.id,
          anime_title: anime.title?.english || anime.title?.romaji,
          anime_image: anime.coverImage?.large || anime.coverImage?.extraLarge || "",
        });
      }

      setWatchlist((prev) => {
        const exists = prev.find((w) => w.anilist_id === anime.id);
        if (exists) {
          const updated = prev.map((w) =>
            w.anilist_id === anime.id ? { ...w, status } : w,
          );
          setStats(calcStats(updated));
          return updated;
        }
        const totalEps = anime.episodes || anime.chapters || 0;
        const newItem = {
          id: data.id,
          anilist_id: anime.id,
          title: anime.title?.english || anime.title?.romaji,
          image: anime.coverImage?.extraLarge || "",
          color: anime.coverImage?.color || null,
          format: anime.format || "",
          type: anime.type || "ANIME",
          progress: 0,
          totalEpisodes: totalEps,
          percentage: 0,
          status,
          userRating: null,
          addedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          _anime: anime,
        };
        const updated = [...prev, newItem];
        setStats(calcStats(updated));
        return updated;
      });
    } catch (e) {
      console.error("handleAddToList error:", e);
    }
  };

  const handleRemoveFromList = async (anilistId) => {
    if (!user) return;
    try {
      await supabase
        .from("watchlist")
        .delete()
        .eq("anilist_id", anilistId)
        .eq("user_id", user.id);
      setWatchlist((prev) => {
        const updated = prev.filter((w) => w.anilist_id !== anilistId);
        setStats(calcStats(updated));
        return updated;
      });
    } catch (e) {
      console.error("handleRemoveFromList error:", e);
    }
  };

  const handleSetRating = async (anilistId, rating) => {
    const item = watchlist.find((w) => w.anilist_id === anilistId);
    if (!item) return;
    const newRating = item.userRating === rating ? null : rating;
    setWatchlist((prev) =>
      prev.map((w) =>
        w.anilist_id === anilistId ? { ...w, userRating: newRating } : w,
      ),
    );
    try {
      await supabase
        .from("watchlist")
        .update({ rating: newRating })
        .eq("anilist_id", anilistId)
        .eq("user_id", user.id);
      if (newRating != null) {
        logActivity("rating", {
          anilist_id: anilistId,
          anime_title: item.title,
          anime_image: item.image,
          payload: { rating: newRating },
        });
      }
    } catch (e) {
      console.error("handleSetRating error:", e);
    }
  };

  const handleSetProgress = async (anilistId, progress) => {
    const item = watchlist.find((w) => w.anilist_id === anilistId);
    if (!item) return;
    const totalEps = item.totalEpisodes || 0;
    const percentage =
      totalEps > 0 ? Math.min(100, (progress / totalEps) * 100) : 0;
    setWatchlist((prev) => {
      const updated = prev.map((w) =>
        w.anilist_id === anilistId ? { ...w, progress, percentage } : w,
      );
      setStats(calcStats(updated));
      return updated;
    });
    try {
      await supabase
        .from("watchlist")
        .update({ progress })
        .eq("anilist_id", anilistId)
        .eq("user_id", user.id);
    } catch (e) {
      console.error("handleSetProgress error:", e);
    }
  };

  if (shareCode) {
    return (
      <PublicCollection
        code={shareCode}
        onExit={() => {
          window.history.replaceState({}, "", window.location.pathname);
          window.location.reload();
        }}
      />
    );
  }

  if (profileCode) {
    return (
      <>
        <PublicProfile
          code={profileCode}
          user={user}
          onAuthOpen={() => setAuthOpen(true)}
          onExit={() => {
            window.history.replaceState({}, "", window.location.pathname);
            window.location.reload();
          }}
        />
        {authOpen && <Auth onClose={() => setAuthOpen(false)} />}
      </>
    );
  }

  return (
    <div className="app">
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        tab={tab}
        setTab={setTab}
        user={user}
        stats={stats}
        profile={profile}
        setProfile={setProfile}
        watchlistCount={watchlist.length}
        onAuthOpen={() => setAuthOpen(true)}
        onLogout={handleLogout}
      />

      <div className={`main-content ${SOCIAL_TABS.includes(tab) ? "main-content--social" : ""}`}>
        <Topbar user={user} stats={stats} watchlist={watchlist} onOpenModal={handleOpenModal} theme={theme} onToggleTheme={toggleTheme} />

        {/* Une erreur dans une page ne doit pas emporter toute l'application :
            la cle sur `tab` remet le garde-fou a zero quand on change de page,
            sinon l'utilisateur resterait bloque sur le message d'erreur. */}
        <ErrorBoundary key={tab}>
        {tab === "home" && (
          <Home
            onOpenModal={handleOpenModal}
            watchlist={watchlist}
            user={user}
            stats={stats}
          />
        )}
        {tab === "calendar" && (
          <Calendar onOpenModal={handleOpenModal} watchlist={watchlist} />
        )}
        {tab === "list" && (
          <Collection
            watchlist={watchlist}
            onOpenModal={handleOpenModal}
            onSetProgress={handleSetProgress}
            user={user}
            onAuthOpen={() => setAuthOpen(true)}
          />
        )}
        {tab === "search" && <Explorer onOpenModal={handleOpenModal} />}
        {tab === "daily" && <Daily user={user} onOpenModal={handleOpenModal} />}
        {tab === "profile" && (
          <Profile
            user={user}
            watchlist={watchlist}
            stats={stats}
            onOpenModal={handleOpenModal}
            profile={profile}
            setProfile={setProfile}
          />
        )}
        {tab === "social" && (
          <Social
            user={user}
            profile={profile}
            setProfile={setProfile}
            stats={stats}
            onOpenModal={handleOpenModal}
            onAuthOpen={() => setAuthOpen(true)}
          />
        )}
        </ErrorBoundary>
      </div>

      {modalOpen && selectedAnime && (
        <AnimeWheel
          anime={selectedAnime}
          onClose={() => setModalOpen(false)}
          onOpenPlayer={(anime) => {
            setPlayerAnime(anime);
            setPlayerOpen(true);
            setModalOpen(false);
          }}
          onAddToList={handleAddToList}
          onRemoveFromList={handleRemoveFromList}
          getItemStatus={getItemStatus}
          getItemRating={getItemRating}
          getItemProgress={getItemProgress}
          onSetRating={handleSetRating}
          onSetProgress={handleSetProgress}
          user={user}
          onAuthOpen={() => setAuthOpen(true)}
        />
      )}

      {playerOpen && playerAnime && (
        <Player anime={playerAnime} onClose={() => setPlayerOpen(false)} />
      )}

      {authOpen && <Auth onClose={() => setAuthOpen(false)} />}
    </div>
  );
}

export default App;
