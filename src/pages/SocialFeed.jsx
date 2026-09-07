import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import ScrollToTop from "../components/ScrollToTop";

const PAGE_SIZE = 30;

/* ─── Horodatage relatif, sans dépendance externe ────────────────── */
function relativeTime(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `il y a ${days} j`;
  return new Date(iso).toLocaleDateString("fr-FR");
}

function activityText(ev) {
  switch (ev.type) {
    case "completed":
      return (
        <>
          a terminé <b>{ev.anime_title}</b>
        </>
      );
    case "rating":
      return (
        <>
          a mis <b>{ev.payload?.rating}★</b> à <b>{ev.anime_title}</b>
        </>
      );
    case "started_watching":
      return (
        <>
          regarde maintenant <b>{ev.anime_title}</b>
        </>
      );
    default:
      return null;
  }
}

/* ─── Widget objectif annuel ──────────────────────────────────────── */
function GoalWidget({ profile, user, setProfile, stats }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(profile?.annual_goal || "");
  const year = new Date().getFullYear();
  const goal = profile?.annual_goal;
  const done = stats?.completed || 0;
  const pct = goal ? Math.min(100, (done / goal) * 100) : 0;

  const save = async () => {
    const n = parseInt(value, 10);
    setEditing(false);
    if (!n || n <= 0) return;
    const { data, error } = await supabase
      .from("profiles")
      .update({ annual_goal: n })
      .eq("id", user.id)
      .select()
      .single();
    if (!error && data) setProfile((p) => ({ ...p, ...data }));
  };

  return (
    <div className="sfw sfw--goal">
      <div className="sfw__head">
        <i className="fas fa-flag-checkered"></i>
        <span>Objectif {year}</span>
        {!editing && (
          <button
            className="sfw__edit"
            onClick={() => {
              setValue(goal || "");
              setEditing(true);
            }}
          >
            <i className="fas fa-pen"></i>
          </button>
        )}
      </div>
      {editing ? (
        <div className="sfw__edit-row">
          <input
            className="sfw__input"
            type="number"
            min="1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            autoFocus
          />
          <button className="btn btn-primary btn-sm" onClick={save}>
            OK
          </button>
        </div>
      ) : goal ? (
        <>
          <div className="sfw__num">
            {done} <span>/ {goal}</span>
          </div>
          <div className="sfw__bar">
            <div className="sfw__bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </>
      ) : (
        <p className="sfw__hint">
          Fixe-toi un nombre d'animés/mangas à terminer cette année.
        </p>
      )}
    </div>
  );
}

/* ─── Widget streak hebdomadaire ──────────────────────────────────── */
function StreakWidget({ profile }) {
  const count = profile?.weekly_streak_count || 0;
  const flames = Math.min(count, 7);
  return (
    <div className="sfw sfw--streak">
      <div className="sfw__head">
        <i className="fas fa-fire"></i>
        <span>Streak hebdo</span>
      </div>
      <div className="pstreak" style={{ padding: "4px 0" }}>
        <div
          className="pstreak__number"
          style={{ color: count > 0 ? "var(--accent)" : "var(--text-7)" }}
        >
          {count}
        </div>
        <div className="pstreak__label">
          semaine{count > 1 ? "s" : ""} à jour
        </div>
        <div className="pstreak__flames">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className={`pstreak__flame ${i < flames ? "pstreak__flame--on" : ""}`}
            >
              <i className="fas fa-fire" />
            </div>
          ))}
        </div>
        {count === 0 && (
          <div className="pstreak__hint">
            Reste à jour sur tes animés en diffusion pour démarrer un streak.
          </div>
        )}
      </div>
    </div>
  );
}

function SocialFeed({ user, profile, setProfile, stats, onOpenModal, onAuthOpen }) {
  const [events, setEvents] = useState([]);
  const [profilesById, setProfilesById] = useState({});
  const [kudosCounts, setKudosCounts] = useState({});
  const [myKudos, setMyKudos] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [hasFollows, setHasFollows] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(
    async (nextPage = 0) => {
      if (!user) return;
      setLoading(true);
      try {
        const { data: followRows } = await supabase
          .from("follows")
          .select("followed_id")
          .eq("follower_id", user.id);
        const ids = [...(followRows || []).map((r) => r.followed_id), user.id];
        setHasFollows((followRows || []).length > 0);

        const from = nextPage * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data: rows, error } = await supabase
          .from("activity_events")
          .select("*")
          .in("user_id", ids)
          .order("created_at", { ascending: false })
          .range(from, to);
        if (error) throw error;

        setHasMore((rows || []).length === PAGE_SIZE);
        setEvents((prev) => (nextPage === 0 ? rows || [] : [...prev, ...(rows || [])]));

        const missing = [...new Set((rows || []).map((r) => r.user_id))].filter(
          (id) => !profilesById[id],
        );
        if (missing.length > 0) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("*")
            .in("id", missing);
          const map = {};
          (profs || []).forEach((p) => {
            map[p.id] = p;
          });
          setProfilesById((prev) => ({ ...prev, ...map }));
        }

        const evIds = (rows || []).map((r) => r.id);
        if (evIds.length > 0) {
          const { data: kudosRows } = await supabase
            .from("kudos")
            .select("activity_id, user_id")
            .in("activity_id", evIds);
          const counts = {};
          const mine = new Set();
          (kudosRows || []).forEach((k) => {
            counts[k.activity_id] = (counts[k.activity_id] || 0) + 1;
            if (k.user_id === user.id) mine.add(k.activity_id);
          });
          setKudosCounts((prev) => ({ ...prev, ...counts }));
          setMyKudos((prev) => new Set([...prev, ...mine]));
        }
      } catch (e) {
        console.error("SocialFeed load error:", e);
      }
      setLoading(false);
    },
    [user, profilesById],
  );

  useEffect(() => {
    setPage(0);
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadMore = () => {
    const p = page + 1;
    setPage(p);
    load(p);
  };

  const toggleKudos = async (activityId) => {
    const already = myKudos.has(activityId);
    setMyKudos((prev) => {
      const n = new Set(prev);
      already ? n.delete(activityId) : n.add(activityId);
      return n;
    });
    setKudosCounts((prev) => ({
      ...prev,
      [activityId]: Math.max(0, (prev[activityId] || 0) + (already ? -1 : 1)),
    }));
    try {
      if (already) {
        await supabase
          .from("kudos")
          .delete()
          .eq("activity_id", activityId)
          .eq("user_id", user.id);
      } else {
        await supabase.from("kudos").insert({ activity_id: activityId, user_id: user.id });
      }
    } catch (e) {
      console.error("toggleKudos error:", e);
    }
  };

  if (!user) {
    return (
      <div className="scroll-area">
        <div className="empty-state" style={{ marginTop: 100 }}>
          <i className="fas fa-bolt"></i>
          <h3>Connecte-toi pour voir le fil</h3>
          <button
            className="btn btn-primary"
            onClick={onAuthOpen}
            style={{ marginTop: 16 }}
          >
            Se connecter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="scroll-area">
      <ScrollToTop />
      <div className="section-wrapper" style={{ paddingTop: "40px" }}>
        <div className="section-header">
          <div className="section-title">
            <i className="fas fa-bolt"></i> Fil
          </div>
        </div>

        <div className="sfw-row">
          <GoalWidget profile={profile} user={user} setProfile={setProfile} stats={stats} />
          <StreakWidget profile={profile} />
        </div>

        {loading && events.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px" }}>
            <i
              className="fas fa-spinner"
              style={{
                fontSize: "2rem",
                color: "var(--accent, #ff5500)",
                animation: "spin 1s linear infinite",
              }}
            ></i>
          </div>
        )}

        {!loading && events.length === 0 && (
          <div className="empty-state">
            <i className="fas fa-user-group"></i>
            <h3>{hasFollows ? "Rien à afficher pour l'instant" : "Ton fil est vide"}</h3>
            <p>
              {hasFollows
                ? "Reviens quand tes abonnements auront de l'activité."
                : "Suis des gens dans l'onglet Abonnements pour voir leur activité ici."}
            </p>
          </div>
        )}

        {events.length > 0 && (
          <div className="sf-list">
            {events.map((ev) => {
              const p = profilesById[ev.user_id];
              const mine = myKudos.has(ev.id);
              return (
                <div key={ev.id} className="sf-row">
                  <div className="fr-avatar" style={{ width: 40, height: 40 }}>
                    {p?.avatar_url ? (
                      <img src={p.avatar_url} alt="" />
                    ) : (
                      <span>{(p?.username || "?")[0].toUpperCase()}</span>
                    )}
                  </div>
                  <div className="sf-row-body">
                    <p className="sf-row-text">
                      <b>{p?.username || "…"}</b> {activityText(ev)}
                    </p>
                    <span className="sf-row-time">{relativeTime(ev.created_at)}</span>
                  </div>
                  {ev.anime_image && (
                    <img
                      src={ev.anime_image}
                      className="sf-row-cover"
                      alt=""
                      onClick={() =>
                        onOpenModal({
                          id: ev.anilist_id,
                          title: { english: ev.anime_title },
                          coverImage: { large: ev.anime_image },
                        })
                      }
                    />
                  )}
                  <button
                    className={`sf-kudos ${mine ? "sf-kudos--active" : ""}`}
                    onClick={() => toggleKudos(ev.id)}
                  >
                    <i className="fas fa-hand-fist"></i>
                    {kudosCounts[ev.id] > 0 && <span>{kudosCounts[ev.id]}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {hasMore && events.length > 0 && (
          <button
            className="btn btn-glass"
            style={{ margin: "24px auto", display: "block" }}
            onClick={loadMore}
            disabled={loading}
          >
            {loading ? "Chargement..." : "Charger plus"}
          </button>
        )}
      </div>
    </div>
  );
}

export default SocialFeed;
