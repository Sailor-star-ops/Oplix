import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllByIds } from '../lib/catalog'
import { MemberCard, TIERS, getTier } from './Profile'

const pad6 = n => String(n || 0).padStart(6, '0')

function PublicProfile({ code, user, onAuthOpen, onExit }) {
  const [profile, setProfile] = useState(null)
  const [favAnimes, setFavAnimes] = useState([])
  const [nowWatching, setNowWatching] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [isFollowing, setIsFollowing] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase
          .from('profiles').select('*')
          .eq('share_code', code).eq('is_public', true).single()
        if (error || !data) { setNotFound(true); setLoading(false); return }
        setProfile(data)

        const ids = [...(data.favorite_animes || []), data.now_watching_id].filter(Boolean)
        if (ids.length > 0) {
          const medias = await fetchAllByIds(ids)
          setFavAnimes((data.favorite_animes || []).map(id => medias.find(m => m.id === id)).filter(Boolean))
          if (data.now_watching_id) setNowWatching(medias.find(m => m.id === data.now_watching_id) || null)
        }
      } catch (e) {
        console.error('PublicProfile load error:', e)
        setNotFound(true)
      }
      setLoading(false)
    }
    load()
  }, [code])

  /* ─── Statut de suivi — seulement si un visiteur connecté regarde le profil de quelqu'un d'autre ─── */
  useEffect(() => {
    if (!user || !profile || user.id === profile.id) { setIsFollowing(false); return }
    let cancelled = false
    supabase
      .from('follows').select('follower_id')
      .eq('follower_id', user.id).eq('followed_id', profile.id)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setIsFollowing(!!data) })
      .catch((e) => console.error('follow status check error:', e))
    return () => { cancelled = true }
  }, [user, profile])

  const toggleFollow = async () => {
    if (!user) { onAuthOpen(); return }
    setFollowBusy(true)
    try {
      if (isFollowing) {
        await supabase.from('follows').delete()
          .eq('follower_id', user.id).eq('followed_id', profile.id)
        setIsFollowing(false)
      } else {
        await supabase.from('follows').insert({ follower_id: user.id, followed_id: profile.id })
        setIsFollowing(true)
      }
    } catch (e) {
      console.error('toggleFollow error:', e)
    }
    setFollowBusy(false)
  }

  if (loading) {
    return <div className="pc-wrap"><i className="fas fa-spinner" style={{ fontSize: '2rem', color: '#ff5500', animation: 'spin 1s linear infinite' }}></i></div>
  }

  if (notFound) {
    return (
      <div className="pc-wrap">
        <div className="empty-state">
          <i className="fas fa-user-slash"></i>
          <h3>Profil introuvable</h3>
          <p>Ce lien n'existe plus ou a été rendu privé.</p>
          <button className="btn btn-primary" onClick={onExit} style={{ marginTop: '16px' }}><i className="fas fa-meteor"></i> Découvrir Oplix</button>
        </div>
      </div>
    )
  }

  const s = profile.stats_cache || {}
  const accent = profile.accent_color || s.tier_color || '#ff5500'
  const tier = getTier(s.completed || 0)
  const tierIndex = TIERS.indexOf(tier)
  const isOwnProfile = user?.id === profile.id

  return (
    <div className="pc-page">
      <div className="pc-header">
        <div className="brand"><i className="fas fa-meteor"></i> <span>OPLIX</span></div>
        <button className="btn btn-primary btn-sm" onClick={onExit}>Découvrir Oplix</button>
      </div>

      <div className="pp-hero" style={{ '--tc': accent }}>
        {profile.banner_url && <div className="pp-hero-banner" style={{ backgroundImage: `url(${profile.banner_url})` }} />}
        <div className="pp-hero-fade" />
        <div className="pp-hero-inner">
          <div className="pp-avatar">
            {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span>{(profile.username || '?')[0].toUpperCase()}</span>}
          </div>
          <div className="pp-hero-info">
            <div className="pp-id-row">
              <span className="pp-tier-tag" style={{ color: accent, borderColor: `${accent}40` }}>{s.tier_label || tier.label}</span>
              <span className="pp-member-id"><i className="fas fa-hashtag" />{pad6(profile.member_id)}</span>
            </div>
            <h1>{profile.username || 'Membre Oplix'}</h1>
            {profile.bio && <p>{profile.bio}</p>}
            <div className="pp-stat-row">
              <div className="pp-stat"><strong>{s.completed ?? 0}</strong><span>Terminés</span></div>
              <div className="pp-stat"><strong>{s.episodes ?? 0}</strong><span>Épisodes</span></div>
              <div className="pp-stat"><strong>{s.hours ?? 0}</strong><span>Heures</span></div>
            </div>
          </div>
          {!isOwnProfile && (
            <button
              className={`pp-follow-btn ${isFollowing ? 'pp-follow-btn--active' : ''}`}
              onClick={toggleFollow}
              disabled={followBusy}
            >
              {isFollowing ? (
                <><i className="fas fa-check"></i> Abonné(e)</>
              ) : (
                <><i className="fas fa-user-plus"></i> {user ? 'Suivre' : 'Se connecter pour suivre'}</>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="section-wrapper">

        <div className="pp-card-wrap">
          <MemberCard
            profile={profile}
            stats={s}
            dominantGenre={s.dominant_genre}
            tier={tier}
            tierIndex={tierIndex}
          />
        </div>

        {nowWatching && (
          <>
            <p className="explorer-label">En ce moment</p>
            <div className="grid-cards" style={{ marginBottom: 36, maxWidth: 220 }}>
              <div className="card">
                <div className="card-img-container"><img src={nowWatching.coverImage?.large} className="card-img" alt="" /></div>
                <div className="card-info"><h3>{nowWatching.title?.english || nowWatching.title?.romaji}</h3></div>
              </div>
            </div>
          </>
        )}

        {favAnimes.length > 0 && (
          <>
            <p className="explorer-label">Animés favoris</p>
            <div className="grid-cards" style={{ marginBottom: 36 }}>
              {favAnimes.map(a => (
                <div className="card" key={a.id}>
                  <div className="card-img-container"><img src={a.coverImage?.large} className="card-img" alt="" /></div>
                  <div className="card-info"><h3>{a.title?.english || a.title?.romaji}</h3></div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="pc-footer-cta">
          <p>Envie de suivre tes propres animés et mangas avec ce niveau de style ?</p>
          <button className="btn btn-primary" onClick={onExit}><i className="fas fa-meteor"></i> Rejoindre Oplix</button>
        </div>
      </div>
    </div>
  )
}

export default PublicProfile
