import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { fetchAllByIds } from "../lib/anilist";
import ScrollToTop from "../components/ScrollToTop";

const pad6 = (n) => String(n || 0).padStart(6, "0");

/* ─── Avatar rond, réutilisé partout dans la page ────────────────── */
function FriendAvatar({ profile, size = 44 }) {
  return (
    <div className="fr-avatar" style={{ width: size, height: size }}>
      {profile?.avatar_url ? (
        <img src={profile.avatar_url} alt="" />
      ) : (
        <span>{(profile?.username || "?")[0].toUpperCase()}</span>
      )}
    </div>
  );
}

/* ─── Collage de couvertures, même logique que Collection.jsx ────── */
function MiniCover({ items, icon, color }) {
  const covers = (items || [])
    .slice(0, 4)
    .map((i) => i.image)
    .filter(Boolean);
  const c = color || "#ff5500";
  if (covers.length === 0) {
    return (
      <div
        className="col-cover col-cover--empty"
        style={{ background: `linear-gradient(135deg, ${c}55, #0d0d0f)` }}
      >
        <i
          className={`fas ${icon || "fa-record-vinyl"}`}
          style={{ color: c }}
        />
      </div>
    );
  }
  if (covers.length === 1)
    return (
      <div className="col-cover">
        <img src={covers[0]} alt="" />
      </div>
    );
  return (
    <div className="col-cover col-cover--grid">
      {covers.map((cv, i) => (
        <img key={i} src={cv} alt="" />
      ))}
      {covers.length < 4 &&
        Array.from({ length: 4 - covers.length }).map((_, i) => (
          <div
            key={`ph${i}`}
            className="col-cover-ph"
            style={{ background: `${c}18` }}
          />
        ))}
    </div>
  );
}

/* ─── Like + duplication d'une collection, réutilisée sur les vues
   en lecture seule (collection d'un abonnement, collection publique) ─── */
function CollectionLikeDuplicate({ collection, user, onAuthOpen }) {
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(0);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicated, setDuplicated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("collection_likes")
      .select("user_id")
      .eq("collection_id", collection.id)
      .then(({ data }) => {
        if (cancelled) return;
        setCount((data || []).length);
        setLiked(!!user && (data || []).some((r) => r.user_id === user.id));
      });
    return () => {
      cancelled = true;
    };
  }, [collection.id, user]);

  const toggleLike = async () => {
    if (!user) return onAuthOpen?.();
    const next = !liked;
    setLiked(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      if (next) {
        await supabase
          .from("collection_likes")
          .insert({ collection_id: collection.id, user_id: user.id });
      } else {
        await supabase
          .from("collection_likes")
          .delete()
          .eq("collection_id", collection.id)
          .eq("user_id", user.id);
      }
    } catch (e) {
      console.error("toggleLike error:", e);
    }
  };

  const duplicate = async () => {
    if (!user) return onAuthOpen?.();
    setDuplicating(true);
    try {
      const { data: newCol, error } = await supabase
        .from("collections")
        .insert({
          user_id: user.id,
          title: `${collection.title} (copie)`,
          description: collection.description || null,
          icon: collection.icon,
          color: collection.color,
          is_public: false,
        })
        .select()
        .single();
      if (error) throw error;

      const items = (collection.collection_items || []).map((it) => ({
        collection_id: newCol.id,
        anilist_id: it.anilist_id,
        title: it.title,
        image: it.image,
        color: it.color,
        format: it.format,
      }));
      if (items.length > 0) {
        await supabase.from("collection_items").insert(items);
      }
      setDuplicated(true);
    } catch (e) {
      console.error("duplicate collection error:", e);
    }
    setDuplicating(false);
  };

  return (
    <div className="col-detail-actions">
      <button className={`btn btn-glass btn-sm ${liked ? "col-like--active" : ""}`} onClick={toggleLike}>
        <i className={`${liked ? "fas" : "far"} fa-heart`}></i> {count > 0 ? count : "J'aime"}
      </button>
      <button className="btn btn-glass btn-sm" onClick={duplicate} disabled={duplicating || duplicated}>
        <i className="fas fa-clone"></i> {duplicated ? "Dupliquée" : duplicating ? "Copie..." : "Dupliquer"}
      </button>
    </div>
  );
}

function Friends({ user, onOpenModal, onAuthOpen }) {
  const [tab, setTab] = useState("following"); // following | followers | discover
  const [followingIds, setFollowingIds] = useState(new Set());
  const [followerIds, setFollowerIds] = useState(new Set());
  const [profilesById, setProfilesById] = useState({});
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const [view, setView] = useState("list"); // list | profile | collection
  const [activeFriendId, setActiveFriendId] = useState(null);
  const [friendCollections, setFriendCollections] = useState([]);
  const [activeCollection, setActiveCollection] = useState(null);
  const [favAnimes, setFavAnimes] = useState([]);
  const [nowWatching, setNowWatching] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /* ─── Chargement des relations (follows) + profils liés ─── */
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [{ data: outRows, error: outErr }, { data: inRows, error: inErr }] =
        await Promise.all([
          supabase.from("follows").select("followed_id").eq("follower_id", user.id),
          supabase.from("follows").select("follower_id").eq("followed_id", user.id),
        ]);
      if (outErr) throw outErr;
      if (inErr) throw inErr;

      const following = new Set((outRows || []).map((r) => r.followed_id));
      const followers = new Set((inRows || []).map((r) => r.follower_id));
      setFollowingIds(following);
      setFollowerIds(followers);

      const ids = [...new Set([...following, ...followers])];
      if (ids.length > 0) {
        const { data: profs, error: pErr } = await supabase
          .from("profiles")
          .select("*")
          .in("id", ids);
        if (pErr) throw pErr;
        const map = {};
        (profs || []).forEach((p) => {
          map[p.id] = p;
        });
        setProfilesById(map);
      } else {
        setProfilesById({});
      }
    } catch (e) {
      console.error("load follows error:", e);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const following = [...followingIds].map((id) => profilesById[id]).filter(Boolean);
  const followers = [...followerIds].map((id) => profilesById[id]).filter(Boolean);

  /* ─── Recherche par pseudo ─── */
  useEffect(() => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      supabase
        .rpc("search_profiles", { search_query: query.trim() })
        .then(({ data, error }) => {
          if (error) throw error;
          setSearchResults(data || []);
        })
        .catch((e) => console.error("search_profiles error:", e))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  /* ─── Actions : follow asymétrique, aucune approbation requise ─── */
  const follow = async (targetId) => {
    if (!targetId || targetId === user.id) return;
    setFollowingIds((prev) => new Set(prev).add(targetId));
    try {
      const { error } = await supabase
        .from("follows")
        .insert({ follower_id: user.id, followed_id: targetId });
      if (error) throw error;
      if (!profilesById[targetId]) load();
    } catch (e) {
      console.error("follow error:", e);
      load();
    }
  };

  const unfollow = async (targetId) => {
    setFollowingIds((prev) => {
      const next = new Set(prev);
      next.delete(targetId);
      return next;
    });
    try {
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", user.id)
        .eq("followed_id", targetId);
      if (error) throw error;
    } catch (e) {
      console.error("unfollow error:", e);
      load();
    }
  };

  /* ─── Détail d'un profil suivi/abonné : profil + ses collections visibles ─── */
  const openFriend = async (friendId) => {
    setActiveFriendId(friendId);
    setView("profile");
    setDetailLoading(true);
    setFavAnimes([]);
    setNowWatching(null);
    setFriendCollections([]);
    try {
      let profile = profilesById[friendId];
      if (!profile) {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", friendId)
          .single();
        profile = data;
        if (profile) setProfilesById((p) => ({ ...p, [friendId]: profile }));
      }
      const ids = [
        ...(profile?.favorite_animes || []),
        profile?.now_watching_id,
      ].filter(Boolean);
      if (ids.length > 0) {
        const medias = await fetchAllByIds(ids);
        setFavAnimes(
          (profile?.favorite_animes || [])
            .map((id) => medias.find((m) => m.id === id))
            .filter(Boolean),
        );
        if (profile?.now_watching_id)
          setNowWatching(
            medias.find((m) => m.id === profile.now_watching_id) || null,
          );
      }
      const { data: cols, error } = await supabase
        .from("collections")
        .select("*, collection_items(*)")
        .eq("user_id", friendId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setFriendCollections(cols || []);
    } catch (e) {
      console.error("openFriend error:", e);
    }
    setDetailLoading(false);
  };

  const backToList = () => {
    setView("list");
    setActiveFriendId(null);
    setActiveCollection(null);
  };
  const backToProfile = () => {
    setView("profile");
    setActiveCollection(null);
  };

  /* ─── Non connecté ─── */
  if (!user) {
    return (
      <div className="scroll-area">
        <div className="empty-state" style={{ marginTop: 100 }}>
          <i className="fas fa-user-group"></i>
          <h3>Connecte-toi pour retrouver ton monde</h3>
          <p>
            Suis des gens, vois leurs listes et leurs collections partagées.
          </p>
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

  /* ══ VUE : détail d'une collection suivie (lecture seule) ══════════ */
  if (view === "collection" && activeCollection) {
    return (
      <div className="scroll-area">
        <ScrollToTop />
        <div className="section-wrapper" style={{ paddingTop: "40px" }}>
          <button
            className="aw-back"
            onClick={backToProfile}
            style={{ marginBottom: "20px" }}
          >
            <i className="fas fa-chevron-left"></i> Retour au profil
          </button>

          <div className="col-detail-head">
            <MiniCover
              items={activeCollection.collection_items}
              icon={activeCollection.icon}
              color={activeCollection.color}
            />
            <div className="col-detail-info">
              <h2>{activeCollection.title}</h2>
              {activeCollection.description && (
                <p>{activeCollection.description}</p>
              )}
              <span className="col-detail-count">
                {activeCollection.collection_items.length} titre
                {activeCollection.collection_items.length > 1 ? "s" : ""}
              </span>
            </div>
          </div>

          <CollectionLikeDuplicate
            collection={activeCollection}
            user={user}
            onAuthOpen={onAuthOpen}
          />

          {activeCollection.collection_items.length === 0 ? (
            <div className="empty-state">
              <i className="fas fa-record-vinyl"></i>
              <h3>Collection vide</h3>
            </div>
          ) : (
            <div className="grid-cards">
              {activeCollection.collection_items.map((item) => (
                <div
                  key={item.id}
                  className="card"
                  onClick={() =>
                    onOpenModal({
                      id: item.anilist_id,
                      title: { english: item.title },
                      coverImage: { large: item.image, color: item.color },
                      format: item.format,
                    })
                  }
                >
                  <div className="card-img-container">
                    <img
                      src={item.image}
                      className="card-img"
                      loading="lazy"
                      alt={item.title}
                    />
                  </div>
                  <div className="card-info">
                    <h3>{item.title}</h3>
                    <p>{item.format || ""}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ══ VUE : profil d'un membre suivi/abonné ══════════════════════════════════════ */
  if (view === "profile" && activeFriendId) {
    const profile = profilesById[activeFriendId];
    const s = profile?.stats_cache || {};
    const accent = profile?.accent_color || s.tier_color || "#ff5500";
    const isFollowing = followingIds.has(activeFriendId);

    return (
      <div className="scroll-area">
        <ScrollToTop />
        <div className="section-wrapper" style={{ paddingTop: "40px" }}>
          <button
            className="aw-back"
            onClick={backToList}
            style={{ marginBottom: "20px" }}
          >
            <i className="fas fa-chevron-left"></i> Retour
          </button>

          {detailLoading ? (
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
          ) : (
            <>
              <div
                className={`pp-hero fr-friend-hero ${profile?.banner_url ? "fr-friend-hero--banner" : ""}`}
                style={{ "--tc": accent }}
              >
                {profile?.banner_url && (
                  <div
                    className="pp-hero-banner"
                    style={{ backgroundImage: `url(${profile.banner_url})` }}
                  />
                )}
                <div className="pp-hero-fade" />
                <div className="pp-hero-inner">
                  <div className="pp-avatar">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="" />
                    ) : (
                      <span>{(profile?.username || "?")[0].toUpperCase()}</span>
                    )}
                  </div>
                  <div className="pp-hero-info">
                    <span
                      className="pp-tier-tag"
                      style={{ color: accent, borderColor: `${accent}40` }}
                    >
                      {s.tier_label || "Watcher"}
                    </span>
                    <h1>{profile?.username || "Membre"}</h1>
                    {profile?.bio && <p>{profile.bio}</p>}
                    <div className="ph__chips" style={{ marginTop: 10 }}>
                      <span className="ph__chip">
                        <i className="fas fa-hashtag"></i>
                        {pad6(profile?.member_id)}
                      </span>
                      {s.total != null && (
                        <span className="ph__chip">
                          <i className="fas fa-layer-group"></i>
                          {s.total} animés
                        </span>
                      )}
                      {s.hours != null && (
                        <span className="ph__chip">
                          <i className="fas fa-clock"></i>
                          {s.hours}h
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    className={`btn btn-sm ${isFollowing ? "btn-danger" : "btn-primary"}`}
                    onClick={() =>
                      isFollowing ? unfollow(activeFriendId) : follow(activeFriendId)
                    }
                    style={{ marginLeft: "auto", alignSelf: "flex-start" }}
                  >
                    <i className={`fas ${isFollowing ? "fa-user-minus" : "fa-user-plus"}`}></i>{" "}
                    {isFollowing ? "Ne plus suivre" : "Suivre"}
                  </button>
                </div>
              </div>

              {s.completed != null && (
                <div className="pqs-grid" style={{ marginBottom: "36px" }}>
                  {[
                    {
                      v: s.watching,
                      l: "En cours",
                      c: "#ff5500",
                      i: "fa-play",
                    },
                    {
                      v: s.completed,
                      l: "Terminés",
                      c: "#4ade80",
                      i: "fa-check",
                    },
                    {
                      v: s.episodes,
                      l: "Épisodes",
                      c: "#60a5fa",
                      i: "fa-clapperboard",
                    },
                    { v: s.hours, l: "Heures", c: "#c084fc", i: "fa-clock" },
                    {
                      v: s.dominant_genre || "—",
                      l: "Genre fav.",
                      c: accent,
                      i: "fa-fire",
                    },
                  ].map((x) => (
                    <div className="pqs" key={x.l} style={{ "--qc": x.c }}>
                      <i className={`fas ${x.i}`}></i>
                      <span className="pqs__v">{x.v}</span>
                      <span className="pqs__l">{x.l}</span>
                    </div>
                  ))}
                </div>
              )}

              {nowWatching && (
                <>
                  <p className="explorer-label">En ce moment</p>
                  <div
                    className="grid-cards"
                    style={{ marginBottom: "36px", maxWidth: "220px" }}
                  >
                    <div
                      className="card"
                      onClick={() => onOpenModal(nowWatching)}
                    >
                      <div className="card-img-container">
                        <img
                          src={nowWatching.coverImage?.large}
                          className="card-img"
                          alt=""
                        />
                      </div>
                      <div className="card-info">
                        <h3>
                          {nowWatching.title?.english ||
                            nowWatching.title?.romaji}
                        </h3>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {favAnimes.length > 0 && (
                <>
                  <p className="explorer-label">Animés favoris</p>
                  <div className="grid-cards" style={{ marginBottom: "36px" }}>
                    {favAnimes.map((a) => (
                      <div
                        className="card"
                        key={a.id}
                        onClick={() => onOpenModal(a)}
                      >
                        <div className="card-img-container">
                          <img
                            src={a.coverImage?.large}
                            className="card-img"
                            alt=""
                          />
                        </div>
                        <div className="card-info">
                          <h3>{a.title?.english || a.title?.romaji}</h3>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <p className="explorer-label">Collections partagées</p>
              {friendCollections.length === 0 ? (
                <p className="aw-panel-hint">
                  Rien de visible pour l'instant —{" "}
                  {profile?.username || "cette personne"} n'a pas encore de
                  collection publique.
                </p>
              ) : (
                <div className="col-grid">
                  {friendCollections.map((col) => (
                    <div
                      key={col.id}
                      className="col-card"
                      onClick={() => {
                        setActiveCollection(col);
                        setView("collection");
                      }}
                    >
                      <MiniCover
                        items={col.collection_items}
                        icon={col.icon}
                        color={col.color}
                      />
                      <div className="col-card-info">
                        <h3>{col.title}</h3>
                        <p>
                          {col.collection_items.length} titre
                          {col.collection_items.length > 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  /* ══ VUE : liste (abonnements / abonnés / découvrir) ═══════════════════ */
  return (
    <div className="scroll-area">
      <ScrollToTop />
      <div className="section-wrapper" style={{ paddingTop: "40px" }}>
        <div className="section-header">
          <div className="section-title">
            <i className="fas fa-users"></i> Social
          </div>
        </div>

        <div className="col-view-toggle">
          <button
            className={tab === "following" ? "active" : ""}
            onClick={() => setTab("following")}
          >
            <i className="fas fa-user-group"></i> Abonnements{" "}
            <span>{following.length}</span>
          </button>
          <button
            className={tab === "followers" ? "active" : ""}
            onClick={() => setTab("followers")}
          >
            <i className="fas fa-user-check"></i> Abonnés{" "}
            <span>{followers.length}</span>
          </button>
          <button
            className={tab === "discover" ? "active" : ""}
            onClick={() => setTab("discover")}
          >
            <i className="fas fa-user-plus"></i> Découvrir
          </button>
        </div>

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

        {!loading &&
          tab === "following" &&
          (following.length === 0 ? (
            <div className="empty-state">
              <i className="fas fa-user-group"></i>
              <h3>Tu ne suis encore personne</h3>
              <p>Utilise l'onglet "Découvrir" pour chercher un pseudo.</p>
            </div>
          ) : (
            <div className="fr-list">
              {following.map((p) => (
                <div key={p.id} className="fr-row" onClick={() => openFriend(p.id)}>
                  <FriendAvatar profile={p} />
                  <div className="fr-row-info">
                    <span className="fr-row-name">{p?.username || "…"}</span>
                    <span className="fr-row-sub">#{pad6(p?.member_id)}</span>
                  </div>
                  <button
                    className="btn btn-glass btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      unfollow(p.id);
                    }}
                  >
                    Ne plus suivre
                  </button>
                </div>
              ))}
            </div>
          ))}

        {!loading &&
          tab === "followers" &&
          (followers.length === 0 ? (
            <div className="empty-state">
              <i className="fas fa-user-check"></i>
              <h3>Personne ne te suit encore</h3>
            </div>
          ) : (
            <div className="fr-list">
              {followers.map((p) => {
                const reciprocal = followingIds.has(p.id);
                return (
                  <div key={p.id} className="fr-row" onClick={() => openFriend(p.id)}>
                    <FriendAvatar profile={p} />
                    <div className="fr-row-info">
                      <span className="fr-row-name">{p?.username || "…"}</span>
                      <span className="fr-row-sub">#{pad6(p?.member_id)}</span>
                    </div>
                    {reciprocal ? (
                      <span className="fr-badge fr-badge--ok">
                        <i className="fas fa-check"></i> Suivi(e)
                      </span>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          follow(p.id);
                        }}
                      >
                        <i className="fas fa-user-plus"></i> Suivre en retour
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

        {tab === "discover" && (
          <div>
            <div
              className="search-box"
              style={{ width: "100%", maxWidth: "420px", marginBottom: "24px" }}
            >
              <i className="fas fa-search search-icon"></i>
              <input
                className="search-input"
                placeholder="Chercher un pseudo..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              {query && (
                <i
                  className="fas fa-times search-clear"
                  onClick={() => {
                    setQuery("");
                    setSearchResults([]);
                  }}
                ></i>
              )}
            </div>

            {searching && <p className="aw-panel-hint">Recherche...</p>}
            {!searching &&
              query.trim().length >= 2 &&
              searchResults.length === 0 && (
                <p className="aw-panel-hint">
                  Aucun pseudo ne correspond à "{query}".
                </p>
              )}

            <div className="fr-list">
              {searchResults
                .filter((p) => p.id !== user.id)
                .map((p) => {
                  const isFollowing = followingIds.has(p.id);
                  return (
                    <div key={p.id} className="fr-row">
                      <FriendAvatar profile={p} />
                      <div className="fr-row-info">
                        <span className="fr-row-name">{p.username}</span>
                        <span className="fr-row-sub">#{pad6(p.member_id)}</span>
                      </div>
                      {isFollowing ? (
                        <button
                          className="btn btn-glass btn-sm"
                          onClick={() => unfollow(p.id)}
                        >
                          <i className="fas fa-check"></i> Suivi(e)
                        </button>
                      ) : (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => follow(p.id)}
                        >
                          <i className="fas fa-user-plus"></i> Suivre
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Friends;
