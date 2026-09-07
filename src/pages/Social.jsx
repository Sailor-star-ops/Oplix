import { useState } from "react";
import SocialFeed from "./SocialFeed";
import Friends from "./Friends";
import Leaderboard from "./Leaderboard";

const SUB_TABS = [
  { id: "feed", label: "Fil", icon: "fa-bolt" },
  { id: "people", label: "Gens", icon: "fa-user-group" },
  { id: "leaderboard", label: "Classement", icon: "fa-ranking-star" },
];

/* ─── Espace Social unifié : Fil / Gens / Classement dans une seule page,
   navigation interne plutôt que 3 entrées de sidebar séparées (elles
   pointaient toutes vers la même notion de "amis") ─── */
function Social({ user, profile, setProfile, stats, onOpenModal, onAuthOpen }) {
  const [subTab, setSubTab] = useState("feed");

  return (
    <div className="social-hub">
      <div className="tabs-row social-hub__tabs">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            className={`tab-btn ${subTab === t.id ? "active" : ""}`}
            onClick={() => setSubTab(t.id)}
          >
            <i className={`fas ${t.icon}`}></i> {t.label}
          </button>
        ))}
      </div>

      <div className="social-hub__body">
        {subTab === "feed" && (
          <SocialFeed
            user={user}
            profile={profile}
            setProfile={setProfile}
            stats={stats}
            onOpenModal={onOpenModal}
            onAuthOpen={onAuthOpen}
          />
        )}
        {subTab === "people" && (
          <Friends user={user} onOpenModal={onOpenModal} onAuthOpen={onAuthOpen} />
        )}
        {subTab === "leaderboard" && (
          <Leaderboard user={user} onAuthOpen={onAuthOpen} />
        )}
      </div>
    </div>
  );
}

export default Social;
