import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

const SIDEBAR_COLOR_PRESETS = [
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

/* ─── Popover de personnalisation de l'en-tête du sidebar ────────── */
function SidebarBannerPicker({ profile, user, setProfile, onClose }) {
  const [url, setUrl] = useState(profile?.sidebar_banner_url || "");
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const persist = async (patch) => {
    if (!user?.id) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", user.id)
      .select()
      .single();
    setSaving(false);
    if (!error && data) setProfile((p) => ({ ...p, ...data }));
  };

  const applyUrl = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    persist({ sidebar_banner_url: trimmed, sidebar_banner_color: null });
  };

  const applyColor = (c) => {
    setUrl("");
    persist({ sidebar_banner_color: c, sidebar_banner_url: null });
  };

  const clearAll = () => {
    setUrl("");
    persist({ sidebar_banner_url: null, sidebar_banner_color: null });
  };

  return (
    <div className="sb-picker" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div className="sb-picker__label">Style de cet espace</div>
      <input
        className="sb-picker__input"
        placeholder="Lien d'image (https://…)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && applyUrl()}
      />
      <button
        className="sb-picker__apply"
        onClick={applyUrl}
        disabled={saving || !url.trim()}
      >
        <i className="fas fa-image"></i> Utiliser cette image
      </button>
      <div className="sb-picker__divider">ou une couleur</div>
      <div className="sb-picker__swatches">
        {SIDEBAR_COLOR_PRESETS.map((c) => (
          <button
            key={c}
            className={`sb-picker__swatch ${profile?.sidebar_banner_color === c ? "sb-picker__swatch--active" : ""}`}
            style={{ background: c }}
            onClick={() => applyColor(c)}
            disabled={saving}
          />
        ))}
      </div>
      <button className="sb-picker__clear" onClick={clearAll} disabled={saving}>
        <i className="fas fa-ban"></i> Aucune (par défaut)
      </button>
    </div>
  );
}

function Sidebar({
  collapsed,
  setCollapsed,
  tab,
  setTab,
  user,
  profile, // <-- Ajout de la prop profile
  setProfile,
  watchlistCount,
  onAuthOpen,
  onLogout,
}) {
  const personalNav = [
    { id: "home", icon: "fa-home", label: "Accueil" },
    { id: "daily", icon: "fa-dice-d6", label: "Animé du jour" },
    { id: "search", icon: "fa-compass", label: "Explorer" },
    { id: "calendar", icon: "fa-calendar-alt", label: "Calendrier" },
    {
      id: "list",
      icon: "fa-layer-group",
      label: "Ma Collection",
      badge: watchlistCount,
    },
  ];
  const SOCIAL_TABS = ["social"];
  const socialNav = [
    { id: "social", icon: "fa-user-group", label: "Amis" },
  ];
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const hasCustomImg = !!profile?.sidebar_banner_url;
  const hasCustomColor = !hasCustomImg && !!profile?.sidebar_banner_color;
  const hasCustomHead = hasCustomImg || hasCustomColor;
  const isSocial = SOCIAL_TABS.includes(tab);
  const activeNav = isSocial ? socialNav : personalNav;

  return (
    <div className={`sidebar ${collapsed ? "collapsed" : ""} ${isSocial ? "sidebar--social" : ""}`}>
      <div className="sidebar-head-wrap">
        <div
          className={`sidebar-head ${hasCustomHead ? "sidebar-head--banner" : ""}`}
        >
          {hasCustomImg && (
            <>
              <div
                className="sidebar-head__banner"
                style={{
                  backgroundImage: `url(${profile.sidebar_banner_url})`,
                }}
              />
              <div className="sidebar-head__fade" />
            </>
          )}
          {hasCustomColor && (
            <>
              <div
                className="sidebar-head__color"
                style={{ "--sbc": profile.sidebar_banner_color }}
              />
              <div className="sidebar-head__fade" />
            </>
          )}
          <div className="brand">
            <i className="fas fa-meteor"></i>
            <span className="brand-text">OPLIX</span>
          </div>
        </div>

        {user && !collapsed && (
          <button
            className="sidebar-head__customize"
            onClick={() => setPickerOpen((o) => !o)}
            title="Personnaliser cet espace"
          >
            <i className="fas fa-palette"></i>
          </button>
        )}
        {pickerOpen && (
          <SidebarBannerPicker
            profile={profile}
            user={user}
            setProfile={setProfile}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>

      <div className={`mode-switch ${collapsed ? "mode-switch--vertical" : ""}`}>
        <div
          className={`mode-switch__thumb ${isSocial ? "mode-switch__thumb--right" : ""}`}
        />
        <button
          className={`mode-switch__opt ${collapsed ? "mode-switch__opt--icon" : ""} ${!isSocial ? "mode-switch__opt--active" : ""}`}
          onClick={() => isSocial && setTab("home")}
          title="Espace perso"
        >
          <i className="fas fa-house-user"></i>
          {!collapsed && "Espace perso"}
        </button>
        <button
          className={`mode-switch__opt ${collapsed ? "mode-switch__opt--icon" : ""} ${isSocial ? "mode-switch__opt--active" : ""}`}
          onClick={() => setTab("social")}
          title="Social"
        >
          <i className="fas fa-users"></i>
          {!collapsed && "Social"}
        </button>
      </div>

      <span className="menu-title">
        {isSocial ? "Espace social" : "Menu principal"}
      </span>

      <nav key={isSocial ? "social" : "personal"} className="nav-swap">
        {activeNav.map((item) => (
          <div
            key={item.id}
            className={`nav-item ${tab === item.id ? "active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            <i className={`fas ${item.icon}`}></i>
            <span className="nav-label">{item.label}</span>
            {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
          </div>
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      {user && (
        <div className="sidebar-logout-wrap">
          {logoutConfirm ? (
            <div className="sidebar-logout-confirm">
              <span
                className="nav-label"
                style={{
                  fontSize: "0.78rem",
                  color: "#a1a1aa",
                  textAlign: "center",
                  display: "block",
                }}
              >
                Confirmer ?
              </span>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginTop: 6,
                  justifyContent: "center",
                }}
              >
                <button
                  className="logout-confirm-btn yes"
                  onClick={() => {
                    onLogout();
                    setLogoutConfirm(false);
                  }}
                >
                  <i className="fas fa-check" />
                </button>
                <button
                  className="logout-confirm-btn no"
                  onClick={() => setLogoutConfirm(false)}
                >
                  <i className="fas fa-times" />
                </button>
              </div>
            </div>
          ) : (
            <div
              className="sidebar-logout-btn"
              onClick={() => setLogoutConfirm(true)}
            >
              <i className="fas fa-right-from-bracket" />
              <span className="nav-label">Se déconnecter</span>
            </div>
          )}
        </div>
      )}

      {/* Bouton réduire recentré */}
      <div className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>
        <i
          className={`fas ${collapsed ? "fa-chevron-right" : "fa-chevron-left"}`}
        ></i>
        <span className="toggle-label">Réduire</span>
      </div>

      {/* Carte Utilisateur modifiée pour l'image de profil */}
      <div
        className={`user-card ${tab === "profile" ? "active-profile" : ""} ${profile?.banner_url ? "user-card--banner" : ""}`}
        onClick={user ? () => setTab("profile") : onAuthOpen}
      >
        {profile?.banner_url && (
          <>
            <div
              className="user-card__banner"
              style={{ backgroundImage: `url(${profile.banner_url})` }}
            />
            <div className="user-card__fade" />
          </>
        )}
        <div className="avatar">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt="Avatar"
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "50%",
                objectFit: "cover",
              }}
            />
          ) : user ? (
            (
              profile?.username?.[0] ||
              user.user_metadata?.username?.[0] ||
              user.email?.[0] ||
              "?"
            ).toUpperCase()
          ) : (
            "?"
          )}
        </div>
        <div className="user-info">
          <h4>
            {profile?.username ||
              (user
                ? user.user_metadata?.username || user.email?.split("@")[0]
                : "Invité")}
          </h4>
          <p>{user ? "Voir mon profil" : "Cliquer pour se connecter"}</p>
        </div>
        {!collapsed && <i className="fas fa-chevron-right user-chevron" />}
      </div>
    </div>
  );
}

export default Sidebar;
