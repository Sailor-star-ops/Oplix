import { useState, useEffect, useRef } from 'react'
import { anilistFetch, Q_TRENDING, Q_SEASONAL, Q_SEARCH, getSeason, stripHtml } from '../lib/anilist'
import ScrollToTop from '../components/ScrollToTop'

/* ─── Constantes ──────────────────────────────────────────────────── */
const GREETINGS_DAY   = ['Bon retour,', 'Content de te revoir,', 'Alors,']
const GREETINGS_NIGHT = ['Encore debout,', 'Séance nocturne,', 'Bonne nuit,']

function getGreeting(username) {
  const h    = new Date().getHours()
  const pool = h >= 22 || h < 6 ? GREETINGS_NIGHT : GREETINGS_DAY
  const line = pool[Math.floor(Math.random() * pool.length)]
  return { line, name: username || 'Otaku' }
}

/* ─── TIERS ───────────────────────────────────────────────────────── */
const TIERS = [
  { min: 0,   label: 'Nouveau Watcher',   color: '#71717a' },
  { min: 10,  label: 'Initié Otaku',       color: '#60a5fa' },
  { min: 30,  label: 'Watcher Confirmé',   color: '#34d399' },
  { min: 60,  label: 'Watcher Légendaire', color: '#ff5500' },
  { min: 100, label: 'Maître des Animés',  color: '#fbbf24' },
  { min: 200, label: 'Otaku Transcendant', color: '#c084fc' },
]
const getTier = n => { let t = TIERS[0]; for (const x of TIERS) { if (n >= x.min) t = x }; return t }

/* ─── AnimeCard ───────────────────────────────────────────────────── */
function AnimeCard({ anime, onClick, showProgress }) {
  const pct = showProgress ? Math.min(100, ((anime.progress || 0) / (anime.totalEpisodes || 1)) * 100) : null
  return (
    <div className="card" onClick={() => onClick(anime._anime || anime)}>
      <div className="card-img-container">
        <img
          src={anime.coverImage?.extraLarge || anime.coverImage?.large || anime.image}
          className="card-img"
          loading="lazy"
          alt={anime.title?.english || anime.title?.romaji || anime.title}
        />
        {anime.averageScore && (
          <div className="score-badge">{(anime.averageScore / 10).toFixed(1)}</div>
        )}
        {anime.status === 'RELEASING' && (
          <div className="airing-badge"><div className="airing-dot" /> EN COURS</div>
        )}
        {showProgress && anime.status === 'watching' && (
          <>
            <div className="status-tag status-watching">En cours</div>
            <div className="progress-bar-card">
              <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </>
        )}
      </div>
      <div className="card-info">
        <h3>{anime.title?.english || anime.title?.romaji || anime.title}</h3>
        {showProgress && anime.progress !== undefined
          ? <p>Ép. {anime.progress}/{anime.totalEpisodes || '?'}</p>
          : <p>{anime.format || ''}</p>}
      </div>
    </div>
  )
}

/* ─── Section scroll horizontal ──────────────────────────────────── */
function HScrollSection({ title, icon, items, onOpenModal, showProgress, emptyMsg, accentColor }) {
  const rowRef = useRef(null)
  const scroll = (dir) => {
    if (rowRef.current) rowRef.current.scrollBy({ left: dir * 600, behavior: 'smooth' })
  }
  return (
    <div className="section-wrapper" style={{ marginBottom: 48 }}>
      <div className="section-header" style={{ marginBottom: 20 }}>
        <div className="section-title">
          <i className={`fas ${icon}`} style={{ color: accentColor || '#ff5500' }} /> {title}
        </div>
        {items && items.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="hscroll-arrow" onClick={() => scroll(-1)}><i className="fas fa-chevron-left" /></button>
            <button className="hscroll-arrow" onClick={() => scroll(1)}><i className="fas fa-chevron-right" /></button>
          </div>
        )}
      </div>
      {(!items || items.length === 0) ? (
        <div style={{ color: '#52525b', fontSize: '.9rem', padding: '20px 0' }}>{emptyMsg}</div>
      ) : (
        <div className="hscroll-row" ref={rowRef}>
          {items.map((anime, i) => (
            <div className="hscroll-item" key={anime.id || anime.anilist_id || i}>
              <AnimeCard anime={anime} onClick={onOpenModal} showProgress={showProgress} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Resume card ─────────────────────────────────────────────────── */
function ResumeCard({ item, onOpenModal }) {
  const pct = item.totalEpisodes > 0
    ? Math.min(100, (item.progress / item.totalEpisodes) * 100)
    : 0
  const remaining = item.totalEpisodes ? item.totalEpisodes - item.progress : null

  return (
    <div
      className="resume-card"
      onClick={() => onOpenModal(item._anime || item)}
      style={{ '--rc': item.color || '#ff5500' }}
    >
      <div className="resume-card__bg">
        <img src={item.image} alt="" />
        <div className="resume-card__overlay" />
      </div>
      <div className="resume-card__cover">
        <img src={item.image} alt={item.title} />
      </div>
      <div className="resume-card__info">
        <div className="resume-card__badge">
          <span className="resume-card__dot" /> EN COURS
        </div>
        <div className="resume-card__title">{item.title}</div>
        <div className="resume-card__ep">
          Épisode <strong>{item.progress}</strong>
          {item.totalEpisodes ? ` / ${item.totalEpisodes}` : ''}
          {remaining !== null && remaining > 0 && (
            <span style={{ color: '#52525b' }}> · {remaining} restants</span>
          )}
        </div>
        <div className="resume-card__bar">
          <div className="resume-card__bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="resume-card__cta">
          <i className="fas fa-play" /> Continuer
        </div>
      </div>
    </div>
  )
}

/* ─── Hero ────────────────────────────────────────────────────────── */
function HeroSection({ heroAnimes, heroIndex, setHeroIndex, onOpenModal }) {
  const hero = heroAnimes[heroIndex]
  if (!hero) return null
  return (
    <div className="hero-section">
      <img src={hero.bannerImage} className="hero-bg" alt="" />
      <div className="hero-gradient" />
      <div className="hero-content">
        <span className="badge-hero">Tendance</span>
        <h1 className="hero-title">{hero.title?.english || hero.title?.romaji}</h1>
        <div className="hero-meta">
          {hero.averageScore && (
            <span className="hero-score">
              <i className="fas fa-star" />{(hero.averageScore / 10).toFixed(1)}
            </span>
          )}
          {hero.genres?.slice(0, 3).map(g => (
            <span key={g} className="hero-genre-tag">{g}</span>
          ))}
        </div>
        <p className="hero-desc">{stripHtml(hero.description)}</p>
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={() => onOpenModal(hero)}>
            <i className="fas fa-ellipsis" /> Voir
          </button>
          <button className="btn btn-glass" onClick={() => onOpenModal(hero)}>
            <i className="fas fa-plus" /> Ajouter
          </button>
        </div>
      </div>
      <div className="hero-dots">
        {heroAnimes.map((_, i) => (
          <div key={i} className={`hero-dot ${i === heroIndex ? 'active' : ''}`} onClick={() => setHeroIndex(i)} />
        ))}
      </div>
    </div>
  )
}

/* ─── Welcome bar ─────────────────────────────────────────────────── */
function WelcomeBar({ user, stats, dominantGenre, tier }) {
  const username = user?.user_metadata?.username || user?.email?.split('@')[0]
  const { line, name } = getGreeting(username)
  const h = new Date().getHours()
  const isNight = h >= 22 || h < 6

  return (
    <div className="welcome-bar">
      <div className="welcome-bar__left">
        <div className="welcome-bar__greeting">
          <span className="welcome-bar__line">{line}</span>
          <span className="welcome-bar__name">{name}</span>
          {isNight && <span className="welcome-bar__moon">🌙</span>}
        </div>
        {tier && (
          <div className="welcome-bar__tier" style={{ color: tier.color }}>
            <span className="welcome-bar__tier-dot" style={{ background: tier.color }} />
            {tier.label}
          </div>
        )}
      </div>
      <div className="welcome-bar__stats">
        {[
          { v: stats?.watching  || 0, l: 'En cours',  i: 'fa-play',         c: '#ff5500' },
          { v: stats?.completed || 0, l: 'Terminés',  i: 'fa-check-circle', c: '#4ade80' },
          { v: stats?.episodes  || 0, l: 'Épisodes',  i: 'fa-clapperboard', c: '#60a5fa' },
          { v: stats?.hours     || 0, l: 'Heures',    i: 'fa-clock',        c: '#c084fc' },
        ].map(s => (
          <div className="welcome-bar__stat" key={s.l}>
            <i className={`fas ${s.i}`} style={{ color: s.c }} />
            <span className="welcome-bar__stat-v">{s.v}</span>
            <span className="welcome-bar__stat-l">{s.l}</span>
          </div>
        ))}
        {dominantGenre && (
          <div className="welcome-bar__stat">
            <i className="fas fa-fire" style={{ color: '#fbbf24' }} />
            <span className="welcome-bar__stat-v" style={{ fontSize: '.8rem' }}>{dominantGenre}</span>
            <span className="welcome-bar__stat-l">Genre fav.</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   HOME PRINCIPAL
═══════════════════════════════════════════════════════════════════ */
function Home({ onOpenModal, watchlist = [], user, stats }) {
  const [trending,     setTrending]     = useState([])
  const [seasonal,     setSeasonal]     = useState([])
  const [genreRecs,    setGenreRecs]    = useState([])
  const [heroAnimes,   setHeroAnimes]   = useState([])
  const [heroIndex,    setHeroIndex]    = useState(0)
  const [loading,      setLoading]      = useState(true)
  const [genreLoading, setGenreLoading] = useState(false)

  const inProgress = watchlist
    .filter(w => w.status === 'watching')
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))

  const recentlyAdded = watchlist
    .slice()
    .sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0))
    .slice(0, 12)

  const genreMap = {}
  watchlist.forEach(item =>
    (item._anime?.genres || []).forEach(g => { genreMap[g] = (genreMap[g] || 0) + 1 })
  )
  const topGenres     = Object.entries(genreMap).sort((a, b) => b[1] - a[1])
  const dominantGenre = topGenres[0]?.[0] || null
  const tier          = getTier(stats?.completed || 0)
  const watchlistIds  = new Set(watchlist.map(w => w.anilist_id))

  useEffect(() => {
    async function fetchData() {
      try {
        const { season, year } = getSeason()
        const [trendData, seasonData] = await Promise.all([
          anilistFetch(Q_TRENDING, { page: 1, perPage: 50 }),
          anilistFetch(Q_SEASONAL, { season, year }),
        ])
        const trendList = trendData.Page.media
        setTrending(trendList)
        setSeasonal(seasonData.Page.media)
        setHeroAnimes(trendList.filter(a => a.bannerImage).slice(0, 5))
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    fetchData()
  }, [])

  useEffect(() => {
    if (!dominantGenre) return
    setGenreLoading(true)
    anilistFetch(Q_SEARCH, {
      type: 'ANIME', perPage: 20, isAdult: false,
      genre: dominantGenre, sort: ['POPULARITY_DESC'],
    })
      .then(data => setGenreRecs(data.Page.media.filter(a => !watchlistIds.has(a.id))))
      .catch(console.error)
      .finally(() => setGenreLoading(false))
  }, [dominantGenre]) // eslint-disable-line

  useEffect(() => {
    if (!heroAnimes.length) return
    const iv = setInterval(() => setHeroIndex(i => (i + 1) % heroAnimes.length), 7000)
    return () => clearInterval(iv)
  }, [heroAnimes])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
      <i className="fas fa-spinner" style={{ fontSize: '2rem', color: '#ff5500', animation: 'spin 1s linear infinite' }} />
    </div>
  )

  const isLoggedIn  = !!user
  const hasWatchlist = watchlist.length > 0

  return (
    <div className="scroll-area">
      <ScrollToTop />

      <HeroSection
        heroAnimes={heroAnimes}
        heroIndex={heroIndex}
        setHeroIndex={setHeroIndex}
        onOpenModal={onOpenModal}
      />

      {/* Welcome bar — alignée via son propre margin horizontal */}
      {isLoggedIn && (
        <WelcomeBar user={user} stats={stats} dominantGenre={dominantGenre} tier={tier} />
      )}

      {/* En cours */}
      {isLoggedIn && inProgress.length > 0 && (
        <div className="section-wrapper" style={{ marginBottom: 52 }}>
          <div className="section-header" style={{ marginBottom: 20 }}>
            <div className="section-title">
              <i className="fas fa-circle-play" style={{ color: '#ff5500' }} />
              Reprends où t'en étais
              <span className="section-count">{inProgress.length} en cours</span>
            </div>
          </div>
          <div className="resume-grid">
            {inProgress.slice(0, 3).map(item => (
              <ResumeCard key={item.anilist_id} item={item} onOpenModal={onOpenModal} />
            ))}
          </div>
        </div>
      )}

      {/* Recs par genre */}
      {isLoggedIn && hasWatchlist && dominantGenre && (
        <HScrollSection
          title={`Parce que tu aimes ${dominantGenre}`}
          icon="fa-wand-magic-sparkles"
          items={genreLoading ? [] : genreRecs}
          onOpenModal={onOpenModal}
          accentColor="#c084fc"
          emptyMsg={genreLoading ? 'Chargement des recommandations…' : 'Aucune recommandation.'}
        />
      )}

      {/* Récemment ajoutés */}
      {isLoggedIn && hasWatchlist && (
        <HScrollSection
          title="Récemment ajoutés à ta liste"
          icon="fa-bookmark"
          items={recentlyAdded}
          onOpenModal={onOpenModal}
          showProgress
          accentColor="#4ade80"
          emptyMsg=""
        />
      )}

      {/* Tendances */}
      <HScrollSection
        title="Tendances"
        icon="fa-fire"
        items={trending.slice(0, 20)}
        onOpenModal={onOpenModal}
        accentColor="#ff5500"
        emptyMsg=""
      />

      {/* Cette saison */}
      <HScrollSection
        title="Cette saison"
        icon="fa-calendar"
        items={seasonal.slice(0, 20)}
        onOpenModal={onOpenModal}
        accentColor="#22d3ee"
        emptyMsg=""
      />

      {/* CTA non connecté */}
      {!isLoggedIn && (
        <div className="home-cta-block">
          <div className="home-cta-block__inner">
            <i className="fas fa-meteor home-cta-block__icon" />
            <h2 className="home-cta-block__title">Ton espace anime t'attend.</h2>
            <p className="home-cta-block__desc">
              Crée ton profil, suis ta progression, découvre ce qui te correspond vraiment.
            </p>
          </div>
        </div>
      )}

    </div>
  )
}

export default Home