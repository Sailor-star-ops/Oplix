import { useState, useEffect, useRef } from 'react'
import { anilistFetch, Q_SEARCH } from '../lib/anilist'
import ScrollToTop from '../components/ScrollToTop'

/* ═══════════════════════════════════════════════════════════
   QUERY — sans notYetAired = toute la semaine
═══════════════════════════════════════════════════════════ */
const Q_WEEK = `
query($page: Int, $from: Int, $to: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
      id episode airingAt
      media {
        id isAdult
        title { romaji english }
        coverImage { extraLarge large color }
        bannerImage genres averageScore format episodes popularity status
      }
    }
  }
}`

/* ═══════════════════════════════════════════════════════════
   CONSTANTES
═══════════════════════════════════════════════════════════ */
const DAYS_SHORT = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']
const DAYS_FULL  = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi']
const MONTHS     = ['jan','fév','mar','avr','mai','juin','juil','aoû','sep','oct','nov','déc']
const BRAND = '#ff5500'
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${alpha})`
}

/* ═══════════════════════════════════════════════════════════
   HELPERS DATE / TEMPS
═══════════════════════════════════════════════════════════ */
function getMonday(date) {
  const d = new Date(date), day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  d.setHours(0,0,0,0); return d
}
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate()+n); return d }
function sameDay(a, b)    { return a.toDateString() === b.toDateString() }
function fmtTime(ts)      { return new Date(ts*1000).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) }
function fmtDate(date)    { return `${date.getDate()} ${MONTHS[date.getMonth()]}` }
function fmtFormat(fmt)   { return ({TV:'TV',TV_SHORT:'Court',MOVIE:'Film',OVA:'OVA',ONA:'ONA',SPECIAL:'Spécial'})[fmt] || '' }

function fmtCountdown(diffSec) {
  if (diffSec <= 0) return null
  const d = Math.floor(diffSec / 86400), h = Math.floor((diffSec % 86400) / 3600)
  const m = Math.floor((diffSec % 3600) / 60), s = diffSec % 60
  if (d >= 1) return `${d}j ${h}h`
  if (h >= 1) return `${h}h ${String(m).padStart(2,'0')}m`
  if (m >= 1) return `${m}m ${String(s).padStart(2,'0')}s`
  return `${s}s`
}

function describeNextAiring(media, now) {
  const nae = media.nextAiringEpisode
  if (nae) {
    const diff = nae.airingAt - now
    const txt = fmtCountdown(diff)
    return { text: `Ép. ${nae.episode} — ${txt ? `dans ${txt}` : 'en direct'}`, airingAt: nae.airingAt, live: diff <= 0 }
  }
  if (media.status === 'FINISHED') return { text: 'Terminé', airingAt: null }
  if (media.status === 'NOT_YET_RELEASED') return { text: 'Date pas encore annoncée', airingAt: null }
  if (media.status === 'CANCELLED') return { text: 'Annulé', airingAt: null }
  return { text: 'Aucune diffusion à venir', airingAt: null }
}

/* ═══════════════════════════════════════════════════════════
   FETCH — plage lun→dim, toutes pages
═══════════════════════════════════════════════════════════ */
async function fetchWeek(monday) {
  const from = Math.floor(monday.getTime() / 1000) - 1
  const to   = Math.floor(addDays(monday, 7).getTime() / 1000)
  let page = 1, all = [], hasNext = true
  while (hasNext && page <= 10) {
    const data = await anilistFetch(Q_WEEK, { page, from, to })
    all = all.concat(data.Page.airingSchedules.filter(s => !s.media.isAdult))
    hasNext = data.Page.pageInfo.hasNextPage
    page++
  }
  return all
}

/* ═══════════════════════════════════════════════════════════
   Countdown live
═══════════════════════════════════════════════════════════ */
function LiveClock({ airingAt }) {
  const [diff, setDiff] = useState(() => airingAt - Math.floor(Date.now()/1000))
  useEffect(() => {
    const id = setInterval(() => setDiff(airingAt - Math.floor(Date.now()/1000)), 1000)
    return () => clearInterval(id)
  }, [airingAt])
  if (diff <= 0) return <span className="cal4-live-pill"><span className="cal4-dot" />En direct</span>
  const txt = fmtCountdown(diff)
  return txt ? <span className="cal4-countdown">dans {txt}</span> : null
}

/* ═══════════════════════════════════════════════════════════
   Une ligne d'épisode — reste la brique de base, déjà compacte
═══════════════════════════════════════════════════════════ */
function EpRow({ item, now, onOpen }) {
  const title  = item.media.title?.english || item.media.title?.romaji || ''
  const isLive = item.airingAt <= now && item.airingAt > now - 2700
  const isPast = item.airingAt < now && !isLive
  const score  = item.media.averageScore
  const cover  = item.media.coverImage?.large
  const fmt    = fmtFormat(item.media.format)

  return (
    <div
      className={`cal4-row${isPast?' cal4-row--past':''}${isLive?' cal4-row--live':''}`}
      style={{ '--c': BRAND, '--c-bg': hexToRgba(BRAND, 0.07), '--c-border': hexToRgba(BRAND, 0.3) }}
      onClick={() => onOpen(item.media)}
    >
      <div className="cal4-row__bar" />
      <div className="cal4-row__time">
        <span className="cal4-row__hm">{fmtTime(item.airingAt)}</span>
        {!isPast && <LiveClock airingAt={item.airingAt} />}
        {isPast  && <span className="cal4-row__aired">diffusé</span>}
      </div>
      <div className="cal4-row__cover">
        {cover ? <img src={cover} alt="" loading="lazy" /> : <div className="cal4-row__cover-ph" />}
        {isLive && <div className="cal4-row__live-dot"><span className="cal4-dot" /></div>}
      </div>
      <div className="cal4-row__info">
        <div className="cal4-row__title">{title}</div>
        <div className="cal4-row__meta">
          <span className="cal4-row__ep">Ép.{item.episode}{item.media.episodes ? `/${item.media.episodes}` : ''}</span>
          {fmt && <span className="cal4-row__fmt">{fmt}</span>}
        </div>
      </div>
      {score > 0 && <div className="cal4-row__score"><span className="cal4-row__star">★</span>{(score/10).toFixed(1)}</div>}
      <div className="cal4-row__arrow"><i className="fas fa-chevron-right" /></div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   ROOT — un jour à la fois, onglets, pas d'empilement
═══════════════════════════════════════════════════════════ */
export default function Calendar({ onOpenModal }) {
  const [items,       setItems]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [weekStart,   setWeekStart]   = useState(() => getMonday(new Date()))
  const [now,         setNow]         = useState(() => Math.floor(Date.now()/1000))
  const [activeGenre, setActiveGenre] = useState(null)
  const [filterOpen,  setFilterOpen]  = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(null) // null = auto (aujourd'hui si dispo)
  const [spotlightId, setSpotlightId] = useState(null) // isole un seul anime dans la vue du jour
  const [query,        setQuery]        = useState('')
  const [searchResults,setSearchResults]= useState([])
  const [searching,    setSearching]    = useState(false)
  const [searchOpen,   setSearchOpen]   = useState(false)
  const filterRef = useRef(null)
  const searchRef = useRef(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now()/1000)), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    setLoading(true); setItems([])
    fetchWeek(weekStart).then(setItems).catch(console.error).finally(() => setLoading(false))
  }, [weekStart])

  useEffect(() => {
    const h = e => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false)
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    if (query.trim().length < 2) { setSearchResults([]); return }
    setSearching(true)
    const t = setTimeout(() => {
      anilistFetch(Q_SEARCH, { search: query.trim(), type: 'ANIME', perPage: 6, isAdult: false, sort: ['SEARCH_MATCH'] })
        .then(data => setSearchResults(data.Page.media))
        .catch(console.error)
        .finally(() => setSearching(false))
    }, 350)
    return () => clearTimeout(t)
  }, [query])

  const goToAiring = (media) => {
    const nae = media.nextAiringEpisode
    if (!nae) { onOpenModal(media); setSearchOpen(false); return }
    const airDate = new Date(nae.airingAt * 1000)
    setWeekStart(getMonday(airDate))
    const dow = airDate.getDay() === 0 ? 6 : airDate.getDay() - 1
    setSelectedIdx(dow)
    setSpotlightId(media.id)
    setSearchOpen(false)
    setQuery('')
  }

  const today     = new Date()
  const weekDays  = Array.from({length:7}, (_,i) => addDays(weekStart, i))
  const weekEnd   = addDays(weekStart, 6)
  const isCurWeek = sameDay(weekStart, getMonday(today))
  const todayIdx  = isCurWeek ? weekDays.findIndex(d => sameDay(d, today)) : -1
  const dayIdx    = selectedIdx ?? (todayIdx >= 0 ? todayIdx : 0)
  const selDay    = weekDays[dayIdx]
  const isSelToday = sameDay(selDay, today)

  const allGenres = [...new Set(items.flatMap(x => x.media.genres||[]))].sort()
  const filtered  = activeGenre ? items.filter(x => x.media.genres?.includes(activeGenre)) : items
  const byDay     = weekDays.map(day => filtered.filter(x => sameDay(new Date(x.airingAt*1000), day)))
  const dayItemsAll = [...byDay[dayIdx]].sort((a,b) => a.airingAt - b.airingAt)
  const dayItems    = spotlightId ? dayItemsAll.filter(x => x.media.id === spotlightId) : dayItemsAll

  const nextUp = isSelToday ? dayItems.find(x => x.airingAt > now) : null

  return (
    <div className="scroll-area">
      <ScrollToTop />
      <div className="cal4-root">

        {/* ══ TOOLBAR ══ */}
        <div className="cal4-toolbar">
          <h1 className="cal4-toolbar__title"><i className="fas fa-satellite-dish" />Calendrier</h1>
          <div className="cal4-toolbar__center">
            <button className="cal4-navbtn" onClick={() => { setWeekStart(d => addDays(d,-7)); setSelectedIdx(null); setSpotlightId(null) }}><i className="fas fa-chevron-left" /></button>
            <button className={`cal4-weekpill${isCurWeek?' cal4-weekpill--on':''}`} onClick={() => { setWeekStart(getMonday(today)); setSelectedIdx(null); setSpotlightId(null) }}>
              {isCurWeek ? 'Cette semaine' : `${fmtDate(weekStart)} — ${fmtDate(weekEnd)}`}
            </button>
            <button className="cal4-navbtn" onClick={() => { setWeekStart(d => addDays(d,7)); setSelectedIdx(null); setSpotlightId(null) }}><i className="fas fa-chevron-right" /></button>
          </div>
          <div className="cal4-toolbar__right" ref={filterRef}>
            <button className={`cal4-filter-btn${activeGenre ? ' cal4-filter-btn--on' : ''}`} onClick={() => setFilterOpen(o => !o)}>
              <i className="fas fa-filter" /> {activeGenre || 'Filtrer'}
            </button>
            {filterOpen && allGenres.length > 0 && (
              <div className="cal4-filter-pop">
                <button className={!activeGenre ? 'active' : ''} onClick={() => { setActiveGenre(null); setFilterOpen(false) }}>Tous les genres</button>
                {allGenres.map(g => (
                  <button key={g} className={activeGenre === g ? 'active' : ''} onClick={() => { setActiveGenre(g); setFilterOpen(false) }}>{g}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ══ RECHERCHE — trouve précisément quand un anime sort ══ */}
        <div className="cal4-search" ref={searchRef}>
          <div className="cal4-search-box">
            <i className="fas fa-search"></i>
            <input
              type="text"
              placeholder="Quand sort... ? Cherche un anime"
              value={query}
              onChange={e => { setQuery(e.target.value); setSearchOpen(true) }}
              onFocus={() => query.trim().length >= 2 && setSearchOpen(true)}
            />
            {query && <i className="fas fa-times cal4-search-clear" onClick={() => { setQuery(''); setSearchResults([]) }}></i>}
          </div>

          {searchOpen && query.trim().length >= 2 && (
            <div className="cal4-search-pop">
              {searching && <div className="cal4-search-loading"><i className="fas fa-spinner"></i> Recherche…</div>}
              {!searching && searchResults.length === 0 && (
                <div className="cal4-search-empty">Aucun anime trouvé pour "{query}"</div>
              )}
              {!searching && searchResults.map(media => {
                const info = describeNextAiring(media, now)
                return (
                  <div key={media.id} className="cal4-search-result" onClick={() => goToAiring(media)}>
                    <img src={media.coverImage?.large} alt="" />
                    <div className="cal4-search-result__info">
                      <span className="cal4-search-result__title">{media.title?.english || media.title?.romaji}</span>
                      <span className={`cal4-search-result__meta${info.live ? ' cal4-search-result__meta--live' : ''}`}>{info.text}</span>
                    </div>
                    {info.airingAt && <i className="fas fa-arrow-right"></i>}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ══ ONGLETS JOUR — un jour à la fois, pas 7 empilés ══ */}
        <div className="cal4-daytabs">
          {weekDays.map((day, i) => {
            const isToday = sameDay(day, today)
            const count = byDay[i].length
            return (
              <button
                key={i}
                className={`cal4-daytab${dayIdx === i ? ' cal4-daytab--active' : ''}${isToday ? ' cal4-daytab--today' : ''}`}
                onClick={() => { setSelectedIdx(i); setSpotlightId(null) }}
              >
                <span className="cal4-daytab__name">{isToday ? "Auj." : DAYS_SHORT[day.getDay()]}</span>
                <span className="cal4-daytab__num">{day.getDate()}</span>
                {count > 0 && <span className="cal4-daytab__count">{count}</span>}
              </button>
            )
          })}
        </div>

        {/* ══ EN-TÊTE DU JOUR SÉLECTIONNÉ ══ */}
        <div className="cal4-dayhead">
          <h2>{isSelToday ? "Aujourd'hui" : DAYS_FULL[selDay.getDay()]} <span>{fmtDate(selDay)}</span></h2>
          {spotlightId ? (
            <button className="cal4-dayhead__clear" onClick={() => setSpotlightId(null)}>
              <i className="fas fa-xmark"></i> Voir tout le jour ({dayItemsAll.length})
            </button>
          ) : (
            nextUp && <span className="cal4-dayhead__next">Prochain à {fmtTime(nextUp.airingAt)} <LiveClock airingAt={nextUp.airingAt} /></span>
          )}
        </div>

        {/* ══ LISTE DU JOUR ══ */}
        {loading ? (
          <div className="cal4-loading"><div className="cal4-spinner" /><span>Chargement…</span></div>
        ) : dayItems.length === 0 ? (
          <div className="cal4-day__empty">
            <i className="fas fa-mug-hot" /> Rien de prévu ce jour-là. Bon moment pour avancer ta liste.
          </div>
        ) : (
          <div className="cal4-agenda">
            {dayItems.map(item => <EpRow key={item.id} item={item} now={now} onOpen={onOpenModal} />)}
          </div>
        )}

      </div>
    </div>
  )
}