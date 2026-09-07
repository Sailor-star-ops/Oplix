import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import ScrollToTop from "../components/ScrollToTop";

/* ─── Tiers ──────────────────────────────────────────────────────── */
export const TIERS = [
  { min: 0, label: "Nouveau Watcher", color: "#71717a", rgb: "113,113,122" },
  { min: 10, label: "Initié Otaku", color: "#60a5fa", rgb: "96,165,250" },
  { min: 30, label: "Watcher Confirmé", color: "#34d399", rgb: "52,211,153" },
  { min: 60, label: "Watcher Légendaire", color: "#ff5500", rgb: "255,85,0" },
  { min: 100, label: "Maître des Animés", color: "#fbbf24", rgb: "251,191,36" },
  {
    min: 200,
    label: "Otaku Transcendant",
    color: "#c084fc",
    rgb: "192,132,252",
  },
];
export const getTier = (n) => {
  let t = TIERS[0];
  for (const x of TIERS) {
    if (n >= x.min) t = x;
  }
  return t;
};
const pad6 = (n) => String(n || 0).padStart(6, "0");
const fmtMonth = () =>
  new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const hexToRgb = (hex) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  return m
    ? `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`
    : "255,85,0";
};

const ACCENT_PRESETS = [
  "#ff5500",
  "#ef4444",
  "#fbbf24",
  "#4ade80",
  "#22d3ee",
  "#60a5fa",
  "#8b5cf6",
  "#c084fc",
  "#f472b6",
];

const SECTION_META = {
  membercard: { label: "Carte de membre", icon: "fa-id-badge" },
  showcase: { label: "Étagère + en ce moment", icon: "fa-heart" },
  badges: { label: "Pastilles (streak, genre, ressenti)", icon: "fa-fire" },
  activity: { label: "Mon journal", icon: "fa-book-open" },
};
const DEFAULT_LAYOUT = [
  { id: "membercard", visible: true },
  { id: "showcase", visible: true },
  { id: "badges", visible: true },
  { id: "activity", visible: true },
];

/* ─── Carte membre — exportée pour être réutilisée sur le profil public ─── */
export function MemberCard({ profile, stats, dominantGenre, tier, tierIndex }) {
  const handleExport = () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
    <stop offset="0%" stop-color="#0a0a0a"/><stop offset="100%" stop-color="#1a0800"/>
  </linearGradient>
  <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
    <stop offset="0%" stop-color="#ff5500"/><stop offset="100%" stop-color="${tier.color}"/>
  </linearGradient>
</defs>
<rect width="640" height="360" rx="20" fill="url(#bg)" stroke="#ff550020" stroke-width="1.5"/>
<rect width="640" height="3" rx="1.5" fill="url(#bar)"/>
<text x="36" y="54" font-family="monospace" font-size="16" font-weight="900" fill="white" letter-spacing="7">OPLIX</text>
<text x="36" y="76" font-family="sans-serif" font-size="9" fill="#3a3a3a" letter-spacing="5">CARTE MEMBRE</text>
<text x="36" y="148" font-family="sans-serif" font-size="36" font-weight="900" fill="white">${profile?.username || "Membre"}</text>
<text x="36" y="176" font-family="sans-serif" font-size="13" fill="${tier.color}" font-weight="700" letter-spacing="2">${tier.label.toUpperCase()}</text>
<text x="36" y="202" font-family="monospace" font-size="11" fill="#2a2a2a">#${pad6(profile?.member_id)}</text>
<line x1="36" y1="226" x2="604" y2="226" stroke="#ffffff07" stroke-width="1"/>
<text x="36" y="258" font-family="sans-serif" font-size="9" fill="#3a3a3a" letter-spacing="3">ÉPISODES</text>
<text x="36" y="286" font-family="sans-serif" font-size="30" font-weight="900" fill="#ff5500">${stats.episodes}</text>
<text x="230" y="258" font-family="sans-serif" font-size="9" fill="#3a3a3a" letter-spacing="3">TERMINÉS</text>
<text x="230" y="286" font-family="sans-serif" font-size="30" font-weight="900" fill="#ff5500">${stats.completed}</text>
<text x="424" y="258" font-family="sans-serif" font-size="9" fill="#3a3a3a" letter-spacing="3">GENRE FAV.</text>
<text x="424" y="286" font-family="sans-serif" font-size="30" font-weight="900" fill="${tier.color}">${dominantGenre || "—"}</text>
<text x="36" y="336" font-family="monospace" font-size="9" fill="#222">OPLIX · ${fmtMonth().toUpperCase()}</text>
</svg>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    a.download = `oplix-${profile?.username || "membre"}.svg`;
    a.click();
  };

  return (
    <div
      className={`mc mc--t${tierIndex}`}
      style={{ "--tc": tier.color, "--rgb": tier.rgb }}
    >
      <div className="mc__holo" />
      <div className="mc__bar" />
      <div className="mc__noise" />
      <div className="mc__head">
        <span className="mc__brand">
          <i className="fas fa-meteor" /> OPLIX
        </span>
        <span className="mc__sublabel">CARTE MEMBRE</span>
      </div>
      <div className="mc__body">
        <div className="mc__avatar">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" />
          ) : (
            <span>{(profile?.username || "?")[0].toUpperCase()}</span>
          )}
          <div className="mc__av-ring" />
        </div>
        <div className="mc__ident">
          <div className="mc__username">{profile?.username || "Membre"}</div>
          <div className="mc__tier">{tier.label}</div>
          <div className="mc__num">#{pad6(profile?.member_id)}</div>
        </div>
      </div>
      <div className="mc__sep" />
      <div className="mc__stats">
        {[
          { v: stats.episodes, l: "Épisodes" },
          { v: stats.completed, l: "Terminés" },
          { v: dominantGenre || "—", l: "Genre fav.", accent: true },
        ].map((s) => (
          <div className="mc__stat" key={s.l}>
            <span
              className="mc__sv"
              style={s.accent ? { color: tier.color } : {}}
            >
              {s.v}
            </span>
            <span className="mc__sl">{s.l}</span>
          </div>
        ))}
      </div>
      <div className="mc__foot">
        <span className="mc__month">{fmtMonth()}</span>
        <button className="mc__xbtn" onClick={handleExport}>
          <i className="fas fa-download" /> Exporter
        </button>
      </div>
    </div>
  );
}

/* ─── Favoris épinglés ───────────────────────────────────────────── */
function FavoritesBlock({ watchlist, favorites, onToggleFav }) {
  const favItems = favorites
    .map((id) => watchlist.find((w) => w.anilist_id === id))
    .filter(Boolean);
  return (
    <div className="pfav">
      <div className="pfav__covers">
        {[0, 1, 2].map((i) => {
          const item = favItems[i];
          return (
            <div className="pfav__slot" key={i}>
              {item ? (
                <div className="pfav__cover">
                  <img src={item.image} alt={item.title} />
                  <div className="pfav__cover-overlay">
                    <span className="pfav__cover-title">{item.title}</span>
                    <button
                      className="pfav__remove"
                      onClick={() => onToggleFav(item.anilist_id)}
                    >
                      <i className="fas fa-times" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="pfav__empty">
                  <i className="fas fa-plus" />
                  <span>Épingler</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {watchlist.length > 0 && favorites.length < 3 && (
        <div className="pfav__picker">
          <div className="pfav__picker-label">Choisir parmi ta liste</div>
          <div className="pfav__picker-list">
            {watchlist
              .filter((w) => !favorites.includes(w.anilist_id))
              .slice(0, 8)
              .map((item) => (
                <div
                  className="pfav__pick-item"
                  key={item.anilist_id}
                  onClick={() => onToggleFav(item.anilist_id)}
                >
                  <img src={item.image} alt={item.title} />
                  <span>{item.title}</span>
                  <i className="fas fa-plus" />
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Streak ─────────────────────────────────────────────────────── */
function StreakBlock({ streak }) {
  const flames = Math.min(streak, 7);
  return (
    <div className="pstreak">
      <div
        className="pstreak__number"
        style={{ color: streak > 0 ? "#ff5500" : "#3f3f46" }}
      >
        {streak}
      </div>
      <div className="pstreak__label">semaine{streak > 1 ? "s" : ""} à jour</div>
      <div className="pstreak__flames">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className={`pstreak__flame ${i < flames ? "pstreak__flame--on" : ""}`}
            style={{ animationDelay: `${i * 0.1}s` }}
          >
            <i className="fas fa-fire" />
          </div>
        ))}
      </div>
      {streak === 0 && (
        <div className="pstreak__hint">
          Reste à jour sur tes animés en diffusion pour démarrer un streak
        </div>
      )}
    </div>
  );
}

/* ─── Animé du moment ─────────────────────────────────────────────── */
function NowWatchingBlock({ watchlist, nowWatchingId, onSet }) {
  const current = watchlist.find((w) => w.anilist_id === nowWatchingId);
  const inProgress = watchlist.filter((w) => w.status === "watching");
  const [picking, setPicking] = useState(false);

  return (
    <div className="pnow">
      {current ? (
        <div className="pnow__active">
          <div className="pnow__cover-wrap">
            <img
              className="pnow__cover"
              src={current.image}
              alt={current.title}
            />
            <div className="pnow__cover-glow" />
          </div>
          <div className="pnow__info">
            <div className="pnow__badge">
              <span className="pnow__dot" />
              EN COURS
            </div>
            <div className="pnow__title">{current.title}</div>
            <div className="pnow__ep">
              {current.progress} / {current.totalEpisodes} épisodes
            </div>
            <div className="pnow__bar">
              <div
                className="pnow__bar-fill"
                style={{ width: `${current.percentage}%` }}
              />
            </div>
            <button
              className="pnow__change"
              onClick={() => setPicking(!picking)}
            >
              <i className="fas fa-shuffle" /> Changer
            </button>
          </div>
        </div>
      ) : (
        <div className="pnow__empty" onClick={() => setPicking(!picking)}>
          <i className="fas fa-tv" />
          <span>Épingler un animé en cours</span>
        </div>
      )}
      {picking && inProgress.length > 0 && (
        <div className="pnow__picker">
          {inProgress.map((item) => (
            <div
              className="pnow__pick"
              key={item.anilist_id}
              onClick={() => {
                onSet(item.anilist_id);
                setPicking(false);
              }}
            >
              <img src={item.image} alt={item.title} />
              <span>{item.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Panneau "Personnaliser l'affichage" ────────────────────────── */
function LayoutPanel({ layout, onChange, onClose }) {
  const move = (index, dir) => {
    const next = [...layout];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const toggle = (index) => {
    const next = [...layout];
    next[index] = { ...next[index], visible: !next[index].visible };
    onChange(next);
  };

  return (
    <div className="mi-overlay" onClick={onClose}>
      <div
        className="mi"
        style={{ maxWidth: 450, height: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="mi__close" onClick={onClose}>
          <i className="fas fa-times" />
        </button>
        <div
          className="mi__body"
          style={{ flexDirection: "column", padding: "32px" }}
        >
          <h3
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: "1.3rem",
              color: "white",
              marginBottom: 8,
            }}
          >
            <i
              className="fas fa-sliders"
              style={{ color: "#ff5500", marginRight: 8 }}
            />{" "}
            Personnaliser l'affichage
          </h3>
          <p
            style={{ color: "#a1a1aa", fontSize: "0.85rem", marginBottom: 24 }}
          >
            Réordonne et affiche/masque les blocs de ton profil.
          </p>
          <div
            className="layout-rows"
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            {layout.map((s, i) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  background: "rgba(255,255,255,0.04)",
                  padding: "12px 16px",
                  borderRadius: "12px",
                  opacity: s.visible ? 1 : 0.5,
                }}
              >
                <i
                  className={`fas ${SECTION_META[s.id]?.icon || "fa-square"}`}
                  style={{ color: "#52525b" }}
                />
                <span style={{ flex: 1, color: "white", fontSize: "0.9rem" }}>
                  {SECTION_META[s.id]?.label || s.id}
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    className="icon-btn btn-sm"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                  >
                    <i className="fas fa-chevron-up" />
                  </button>
                  <button
                    className="icon-btn btn-sm"
                    onClick={() => move(i, 1)}
                    disabled={i === layout.length - 1}
                  >
                    <i className="fas fa-chevron-down" />
                  </button>
                  <button className="icon-btn btn-sm" onClick={() => toggle(i)}>
                    <i
                      className={`fas ${s.visible ? "fa-eye" : "fa-eye-slash"}`}
                      style={{ color: s.visible ? "#ff5500" : "#52525b" }}
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Modal édition ─────────────────────────────────────────────── */
function EditModal({ profile, onClose, onSave }) {
  const [form, setForm] = useState({
    username: profile?.username || "",
    bio: profile?.bio || "",
    avatar_url: profile?.avatar_url || "",
    banner_url: profile?.banner_url || "",
    accent_color: profile?.accent_color || "",
    title: profile?.title || "",
    title_override: profile?.title_override || false,
  });
  const [avatarFile, setAvatarFile] = useState(null);
  const [bannerFile, setBannerFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const upload = async (file, bucket, uid) => {
    const path = `${uid}/${Date.now()}.${file.name.split(".").pop()}`;
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { upsert: true });
    if (error) throw error;
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  };

  const save = async () => {
    setLoading(true);
    setError("");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      let u = { ...form };
      if (avatarFile)
        u.avatar_url = await upload(avatarFile, "avatars", user.id);
      if (bannerFile)
        u.banner_url = await upload(bannerFile, "avatars", user.id);
      const { error } = await supabase
        .from("profiles")
        .update(u)
        .eq("id", user.id);
      if (error) throw error;
      onSave(u);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mi-overlay" onClick={onClose}>
      <div
        className="mi"
        style={{ maxWidth: 500, height: "auto", maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="mi__close" onClick={onClose}>
          <i className="fas fa-times" />
        </button>
        <div
          className="mi__body"
          style={{
            flexDirection: "column",
            padding: "36px",
            overflowY: "auto",
          }}
        >
          <h2
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              marginBottom: 24,
              fontSize: "1.6rem",
              color: "white",
            }}
          >
            Modifier le profil
          </h2>

          {error && (
            <div className="auth-error">
              <i className="fas fa-circle-exclamation" /> {error}
            </div>
          )}

          {[
            ["Pseudo", "username"],
            ["Bio", "bio"],
          ].map(([lbl, key]) => (
            <div className="form-group" key={key}>
              <label className="form-label">{lbl}</label>
              {key === "bio" ? (
                <textarea
                  className="form-input"
                  rows={3}
                  value={form[key]}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, [key]: e.target.value }))
                  }
                  style={{ resize: "vertical" }}
                />
              ) : (
                <input
                  className="form-input"
                  value={form[key]}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, [key]: e.target.value }))
                  }
                />
              )}
            </div>
          ))}

          <div className="form-group">
            <label className="form-label">Avatar</label>
            <input
              className="form-input"
              placeholder="Lien direct (https://…)"
              value={form.avatar_url}
              onChange={(e) =>
                setForm((p) => ({ ...p, avatar_url: e.target.value }))
              }
              style={{ marginBottom: 12 }}
            />
            <input
              type="file"
              accept="image/*"
              className="form-file-input"
              onChange={(e) => setAvatarFile(e.target.files[0])}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Bannière</label>
            <input
              className="form-input"
              placeholder="Lien direct (https://…)"
              value={form.banner_url}
              onChange={(e) =>
                setForm((p) => ({ ...p, banner_url: e.target.value }))
              }
              style={{ marginBottom: 12 }}
            />
            <input
              type="file"
              accept="image/*"
              className="form-file-input"
              onChange={(e) => setBannerFile(e.target.files[0])}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Couleur d'accent</label>
            <div className="col-picker-row">
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`col-color-btn${form.accent_color === c ? " active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setForm((p) => ({ ...p, accent_color: c }))}
                />
              ))}
              <button
                type="button"
                className={`col-color-btn${!form.accent_color ? " active" : ""}`}
                style={{
                  background: "#27272a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                title="Suivre mon palier (défaut)"
                onClick={() => setForm((p) => ({ ...p, accent_color: "" }))}
              >
                <i
                  className="fas fa-rotate-left"
                  style={{ fontSize: ".65rem", color: "#a1a1aa" }}
                />
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              Titre perso{" "}
              <span
                style={{
                  color: "#52525b",
                  fontWeight: 400,
                  textTransform: "none",
                }}
              >
                (vide = auto selon ton palier)
              </span>
            </label>
            <input
              className="form-input"
              placeholder="Ex : Roi de l'isekai"
              value={form.title}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  title: e.target.value,
                  title_override: e.target.value.length > 0,
                }))
              }
            />
          </div>

          <button
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 12, justifyContent: "center" }}
            onClick={save}
            disabled={loading}
          >
            {loading ? (
              <>
                <i className="fas fa-spinner fa-spin" /> Enregistrement…
              </>
            ) : (
              "Enregistrer"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Profile({
  user,
  watchlist,
  stats,
  profile,
  setProfile,
}) {
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [nowWatchingId, setNowWatchingId] = useState(null);
  const streak = profile?.weekly_streak_count || 0;
  const [copied, setCopied] = useState(false);
  const [previewTierIdx, setPreviewTierIdx] = useState(null);

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setProfile(data);
          setFavorites(data.favorite_animes || []);
          setNowWatchingId(data.now_watching_id || null);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [user?.id, setProfile]);

  const genreMap = {};
  watchlist.forEach((item) =>
    (item._anime?.genres || []).forEach((g) => {
      genreMap[g] = (genreMap[g] || 0) + 1;
    }),
  );
  const topGenres = Object.entries(genreMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const dominantGenre = topGenres[0]?.[0] || null;

  const baseTier = getTier(stats.completed);
  const tierIndex = TIERS.indexOf(baseTier);
  const tier =
    profile?.title_override && profile?.title
      ? { ...baseTier, label: profile.title }
      : baseTier;
  const accent = profile?.accent_color || tier.color;
  const accentRgb = profile?.accent_color
    ? hexToRgb(profile.accent_color)
    : tier.rgb;

  const ratedItems = watchlist.filter((w) => w.userRating);
  const avgScore =
    ratedItems.length > 0
      ? (
          ratedItems.reduce((acc, w) => acc + w.userRating, 0) /
          ratedItems.length
        ).toFixed(1)
      : null;

  const nextTier = TIERS.find((t) => t.min > stats.completed);
  const levelPct = nextTier
    ? Math.min(
        100,
        ((stats.completed - tier.min) / (nextTier.min - tier.min)) * 100,
      )
    : 100;

  useEffect(() => {
    if (!user || !profile) return;
    const snapshot = {
      ...stats,
      dominant_genre: dominantGenre,
      tier_label: tier.label,
      tier_color: tier.color,
    };
    const same =
      JSON.stringify(profile.stats_cache) === JSON.stringify(snapshot);
    if (same) return;
    supabase
      .from("profiles")
      .update({ stats_cache: snapshot })
      .eq("id", user.id);
  }, [user, profile, stats, dominantGenre, tier.label, tier.color]);

  const layout =
    profile?.layout && profile.layout.length === DEFAULT_LAYOUT.length
      ? profile.layout
      : DEFAULT_LAYOUT;

  const handleToggleFav = async (id) => {
    const next = favorites.includes(id)
      ? favorites.filter((f) => f !== id)
      : favorites.length < 3
        ? [...favorites, id]
        : favorites;
    setFavorites(next);
    await supabase
      .from("profiles")
      .update({ favorite_animes: next })
      .eq("id", user.id);
  };

  const handleSetNowWatching = async (id) => {
    setNowWatchingId(id);
    await supabase
      .from("profiles")
      .update({ now_watching_id: id })
      .eq("id", user.id);
  };

  const [editingGoal, setEditingGoal] = useState(false);
  const [goalValue, setGoalValue] = useState("");
  const handleSaveGoal = async () => {
    const n = parseInt(goalValue, 10);
    setEditingGoal(false);
    if (!n || n <= 0) return;
    const { data, error } = await supabase
      .from("profiles")
      .update({ annual_goal: n })
      .eq("id", user.id)
      .select()
      .single();
    if (!error && data) setProfile((p) => ({ ...p, ...data }));
  };

  const handleLayoutChange = async (next) => {
    setProfile((p) => ({ ...p, layout: next }));
    await supabase.from("profiles").update({ layout: next }).eq("id", user.id);
  };

  const togglePublic = async () => {
    const makingPublic = !profile?.is_public;
    const shareCode =
      profile?.share_code || Math.random().toString(36).slice(2, 10);
    const { data, error } = await supabase
      .from("profiles")
      .update({ is_public: makingPublic, share_code: shareCode })
      .eq("id", user.id)
      .select()
      .single();
    if (!error) setProfile(data);
  };

  if (!user)
    return (
      <div className="scroll-area">
        <div className="empty-state" style={{ marginTop: 100 }}>
          <i className="fas fa-user-slash" />
          <h3>Connecte-toi pour accéder à ton profil</h3>
        </div>
      </div>
    );

  if (loading)
    return (
      <div className="scroll-area">
        <div className="empty-state" style={{ marginTop: 100 }}>
          <i
            className="fas fa-spinner fa-spin"
            style={{ color: "#ff5500", fontSize: "2rem" }}
          />
        </div>
      </div>
    );

  const sectionBody = (id) => {
    switch (id) {
      case "membercard": {
        const shownIdx = previewTierIdx ?? tierIndex;
        const shownTier = previewTierIdx != null ? TIERS[previewTierIdx] : tier;
        return (
          <div className="pmembercard" key={id}>
            <div className="pmembercard__wrap">
              <MemberCard
                profile={profile}
                stats={stats}
                dominantGenre={dominantGenre}
                tier={shownTier}
                tierIndex={shownIdx}
              />
              <div className="pmc-preview">
                <span className="pmc-preview__label">Aperçu palier (test)</span>
                <div className="pmc-preview__dots">
                  {TIERS.map((t, i) => (
                    <button
                      key={t.label}
                      className={`pmc-preview__dot ${shownIdx === i ? "pmc-preview__dot--active" : ""}`}
                      style={{ "--dc": t.color }}
                      onClick={() =>
                        setPreviewTierIdx(i === tierIndex ? null : i)
                      }
                      title={t.label}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
                {previewTierIdx != null && (
                  <button
                    className="pmc-preview__reset"
                    onClick={() => setPreviewTierIdx(null)}
                  >
                    <i className="fas fa-rotate-left" /> Revenir à mon palier
                    réel
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      }
      case "showcase":
        return (
          <div className="pshowcase" key={id}>
            <p className="pshowcase__label">Mon étagère</p>
            <FavoritesBlock
              watchlist={watchlist}
              favorites={favorites}
              onToggleFav={handleToggleFav}
            />
            <NowWatchingBlock
              watchlist={watchlist}
              nowWatchingId={nowWatchingId}
              onSet={handleSetNowWatching}
            />
          </div>
        );

      case "badges":
        return (
          <div key={id}>
            <div className="sfw sfw--goal" style={{ marginBottom: 16, maxWidth: 320 }}>
              <div className="sfw__head">
                <i className="fas fa-flag-checkered"></i>
                <span>Objectif {new Date().getFullYear()}</span>
                {!editingGoal && (
                  <button
                    className="sfw__edit"
                    onClick={() => {
                      setGoalValue(profile?.annual_goal || "");
                      setEditingGoal(true);
                    }}
                  >
                    <i className="fas fa-pen"></i>
                  </button>
                )}
              </div>
              {editingGoal ? (
                <div className="sfw__edit-row">
                  <input
                    className="sfw__input"
                    type="number"
                    min="1"
                    value={goalValue}
                    onChange={(e) => setGoalValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveGoal()}
                    autoFocus
                  />
                  <button className="btn btn-primary btn-sm" onClick={handleSaveGoal}>
                    OK
                  </button>
                </div>
              ) : profile?.annual_goal ? (
                <>
                  <div className="sfw__num">
                    {stats.completed} <span>/ {profile.annual_goal}</span>
                  </div>
                  <div className="sfw__bar">
                    <div
                      className="sfw__bar-fill"
                      style={{
                        width: `${Math.min(100, (stats.completed / profile.annual_goal) * 100)}%`,
                      }}
                    />
                  </div>
                </>
              ) : (
                <p className="sfw__hint">
                  Fixe-toi un nombre d'animés/mangas à terminer cette année.
                </p>
              )}
            </div>
          <div className="pbadges">
            {streak > 0 && (
              <div className="pbadge">
                <i className="fas fa-fire" style={{ color: "#ff5500" }} />
                <span>
                  <b>{streak}</b> semaine{streak > 1 ? "s" : ""} à jour
                </span>
              </div>
            )}
            {dominantGenre && (
              <div className="pbadge">
                <i className="fas fa-heart" style={{ color: accent }} />
                <span>
                  Team <b>{dominantGenre}</b>
                </span>
              </div>
            )}
            {avgScore && (
              <div className="pbadge">
                <i className="fas fa-star" style={{ color: "#fbbf24" }} />
                <span>
                  Note ça en moyenne <b>{avgScore}/10</b>
                </span>
              </div>
            )}
            {stats.completed > 0 && (
              <div className="pbadge">
                <i
                  className="fas fa-clapperboard"
                  style={{ color: "#60a5fa" }}
                />
                <span>
                  <b>{stats.completed}</b> terminé
                  {stats.completed > 1 ? "s" : ""}
                </span>
              </div>
            )}
            </div>
          </div>
        );

      case "activity":
        return watchlist.length > 0 ? (
          <div className="pjournal" key={id}>
            <p className="pshowcase__label">
              Mon journal{" "}
              <span>ce que tu regardes, dans l'ordre où ça t'arrive</span>
            </p>
            <div className="pjournal__scroll">
              {watchlist.slice(0, 12).map((item) => (
                <div className="pact-card" key={item.anilist_id}>
                  <div className="pact-card__img">
                    <img src={item.image} alt={item.title} />
                    <div className="pact-card__overlay" />
                    <span
                      className={`pact-card__badge pact-card__badge--${item.status === "plan_to_watch" ? "plan" : item.status}`}
                    >
                      {
                        {
                          watching: "En cours",
                          completed: "Terminé",
                          plan_to_watch: "À voir",
                          dropped: "Abandonné",
                        }[item.status]
                      }
                    </span>
                    {item.userRating && (
                      <span className="pact-card__rating">
                        <i className="fas fa-star" />
                        {item.userRating}
                      </span>
                    )}
                    <div className="pact-card__progress">
                      <div style={{ width: `${item.percentage}%` }} />
                    </div>
                  </div>
                  <div className="pact-card__info">
                    <div className="pact-card__title">{item.title}</div>
                    <div className="pact-card__ep">
                      {item.progress}/{item.totalEpisodes} ep.
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null;
      default:
        return null;
    }
  };

  const visibleOrdered = layout.filter((s) => s.visible);

  return (
    <div className="scroll-area profile-root">
      <ScrollToTop />
      <div className="ph" style={{ "--tc": accent, "--rgb": accentRgb }}>
        {profile?.banner_url ? (
          <div
            className="ph__banner"
            style={{ backgroundImage: `url(${profile.banner_url})` }}
          />
        ) : (
          <div className="ph__banner ph__banner--default" />
        )}
        <div className="ph__overlay" />

        <div className="ph__content">
          <div className="ph__toprow">
            <div className="ph__avatar-wrap">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="ph__avatar" />
              ) : (
                <div className="ph__avatar ph__avatar--fallback">
                  {(profile?.username || "?")[0].toUpperCase()}
                </div>
              )}
              <span className="ph__tier-badge" style={{ background: accent }}>
                {tier.label}
              </span>
            </div>

            <div className="ph__actions">
              <button
                className="btn btn-secondary"
                onClick={() => setEditOpen(true)}
              >
                <i className="fas fa-pen" /> Modifier
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setLayoutOpen(true)}
              >
                <i className="fas fa-sliders" /> Agencement
              </button>
              <button
                className={`btn btn-secondary ${profile?.is_public ? "btn-active" : ""}`}
                onClick={togglePublic}
                title="Rendre public"
              >
                <i
                  className={`fas ${profile?.is_public ? "fa-globe" : "fa-lock"}`}
                />
              </button>
            </div>
          </div>

          <div className="ph__info">
            <h1 className="ph__username">{profile?.username || "Membre"}</h1>
            {profile?.bio && <p className="ph__bio">{profile.bio}</p>}
            <div className="ph__meta">
              <span>
                <i className="fas fa-id-badge" /> #{pad6(profile?.member_id)}
              </span>
              <span>
                <i className="fas fa-calendar" /> Membre depuis {fmtMonth()}
              </span>
            </div>
          </div>

          <div className="ph__lvlbar">
            <div className="ph__lvlbar-info">
              <span>
                Niveau {tierIndex + 1} : {tier.label}
              </span>
              <span>
                {stats.completed} / {nextTier ? nextTier.min : stats.completed}{" "}
                animés
              </span>
            </div>
            <div className="ph__lvlbar-track">
              <div
                className="ph__lvlbar-fill"
                style={{ width: `${levelPct}%`, background: accent }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="profile-sections">
        {visibleOrdered.map((sec) => sectionBody(sec.id))}
      </div>

      {editOpen && (
        <EditModal
          profile={profile}
          onClose={() => setEditOpen(false)}
          onSave={(updated) => setProfile((p) => ({ ...p, ...updated }))}
        />
      )}
      {layoutOpen && (
        <LayoutPanel
          layout={layout}
          onChange={handleLayoutChange}
          onClose={() => setLayoutOpen(false)}
        />
      )}
    </div>
  );
}
