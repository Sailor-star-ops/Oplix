import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import ScrollToTop from "../components/ScrollToTop";

const pad6 = (n) => String(n || 0).padStart(6, "0");

function monthStartISO() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

function Leaderboard({ user, onAuthOpen }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const { data: followRows } = await supabase
          .from("follows")
          .select("followed_id")
          .eq("follower_id", user.id);
        const ids = [...(followRows || []).map((r) => r.followed_id), user.id];

        const { data: events, error } = await supabase
          .from("activity_events")
          .select("user_id")
          .eq("type", "completed")
          .gte("created_at", monthStartISO())
          .in("user_id", ids);
        if (error) throw error;

        const counts = {};
        ids.forEach((id) => { counts[id] = 0; });
        (events || []).forEach((e) => {
          counts[e.user_id] = (counts[e.user_id] || 0) + 1;
        });

        const { data: profs } = await supabase
          .from("profiles")
          .select("id, username, avatar_url, member_id")
          .in("id", ids);
        const profileById = {};
        (profs || []).forEach((p) => { profileById[p.id] = p; });

        const ranked = ids
          .map((id) => ({ id, count: counts[id] || 0, profile: profileById[id] }))
          .filter((r) => r.profile)
          .sort((a, b) => b.count - a.count);

        if (!cancelled) setRows(ranked);
      } catch (e) {
        console.error("Leaderboard load error:", e);
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) {
    return (
      <div className="scroll-area">
        <div className="empty-state" style={{ marginTop: 100 }}>
          <i className="fas fa-ranking-star"></i>
          <h3>Connecte-toi pour voir le classement</h3>
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

  const monthLabel = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const trophy = ["fa-trophy lb-gold", "fa-trophy lb-silver", "fa-trophy lb-bronze"];

  return (
    <div className="scroll-area">
      <ScrollToTop />
      <div className="section-wrapper" style={{ paddingTop: "40px" }}>
        <div className="section-header">
          <div className="section-title">
            <i className="fas fa-ranking-star"></i> Classement
          </div>
        </div>
        <p className="aw-panel-hint" style={{ marginBottom: 20, textTransform: "capitalize" }}>
          Animés/mangas terminés en {monthLabel}, parmi tes abonnements
        </p>

        {loading && (
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

        {!loading && rows.length === 0 && (
          <div className="empty-state">
            <i className="fas fa-ranking-star"></i>
            <h3>Rien à classer pour l'instant</h3>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="fr-list">
            {rows.map((r, i) => (
              <div
                key={r.id}
                className={`fr-row lb-row ${r.id === user.id ? "lb-row--me" : ""}`}
              >
                <span className="lb-rank">
                  {i < 3 ? <i className={`fas ${trophy[i]}`}></i> : i + 1}
                </span>
                <div className="fr-avatar" style={{ width: 44, height: 44 }}>
                  {r.profile.avatar_url ? (
                    <img src={r.profile.avatar_url} alt="" />
                  ) : (
                    <span>{(r.profile.username || "?")[0].toUpperCase()}</span>
                  )}
                </div>
                <div className="fr-row-info">
                  <span className="fr-row-name">
                    {r.profile.username || "…"} {r.id === user.id && "(toi)"}
                  </span>
                  <span className="fr-row-sub">#{pad6(r.profile.member_id)}</span>
                </div>
                <span className="lb-count">{r.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Leaderboard;
