import { useState, useEffect, useCallback, useRef } from 'react'
import {
  searchMedia,
  GENRES_ANIME, GENRES_MANGA,
  ANIME_FORMATS, MANGA_FORMATS,
  STATUS_OPTIONS, SORT_OPTIONS,
  currentAnilistYear,
} from '../lib/catalog'
import ScrollToTop from '../components/ScrollToTop'

const PER_PAGE = 24
const CURRENT_YEAR = currentAnilistYear()
const YEARS = Array.from({ length: CURRENT_YEAR - 1959 }, (_, i) => CURRENT_YEAR - i)

const DEFAULT_FILTERS = {
  type: 'ANIME',
  genres: [],
  formats: [],
  status: '',
  year: '',
  sort: 'TRENDING_DESC',
}

function countActive(f, query) {
  let n = 0
  if (query) n++
  if (f.genres.length) n += f.genres.length
  if (f.formats.length) n += f.formats.length
  if (f.status) n++
  if (f.year) n++
  if (f.sort !== DEFAULT_FILTERS.sort) n++
  return n
}

/* ─── Sélecteur d'année : popover en grille par décennie ─── */
function YearPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [decadeStart, setDecadeStart] = useState(() => {
    const base = value ? parseInt(value) : CURRENT_YEAR
    return base - (base % 10)
  })
  const ref = useRef(null)

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const decadeYears = Array.from({ length: 10 }, (_, i) => decadeStart + i).filter(y => y <= CURRENT_YEAR && y >= 1960)

  return (
    <div className="yp" ref={ref}>
      <button className={`yp-trigger${value ? ' yp-trigger--active' : ''}`} onClick={() => setOpen(o => !o)}>
        <i className="fas fa-calendar-day"></i>
        <span>{value || 'Toutes les années'}</span>
        <i className={`fas fa-chevron-down yp-chev${open ? ' yp-chev--open' : ''}`}></i>
      </button>

      {open && (
        <div className="yp-panel">
          <div className="yp-panel-head">
            <button onClick={() => setDecadeStart(d => d - 10)} disabled={decadeStart <= 1960}>
              <i className="fas fa-chevron-left"></i>
            </button>
            <span>{decadeStart} – {decadeStart + 9}</span>
            <button onClick={() => setDecadeStart(d => d + 10)} disabled={decadeStart + 10 > CURRENT_YEAR}>
              <i className="fas fa-chevron-right"></i>
            </button>
          </div>
          <div className="yp-grid">
            {decadeYears.map(y => (
              <button
                key={y}
                className={`yp-year${value === String(y) ? ' yp-year--active' : ''}${y === CURRENT_YEAR ? ' yp-year--current' : ''}`}
                onClick={() => { onChange(value === String(y) ? '' : String(y)); setOpen(false) }}
              >{y}</button>
            ))}
          </div>
          {value && (
            <button className="yp-clear" onClick={() => { onChange(''); setOpen(false) }}>
              <i className="fas fa-rotate-left"></i> Toutes les années
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Explorer({ onOpenModal, initialQuery }) {
  const [query, setQuery] = useState(initialQuery || '')
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [panelOpen, setPanelOpen] = useState(false)

  const [results, setResults] = useState([])
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState(false)

  const requestId = useRef(0)

  const genreList = filters.type === 'ANIME' ? GENRES_ANIME : GENRES_MANGA
  const formatList = filters.type === 'ANIME' ? ANIME_FORMATS : MANGA_FORMATS
  const activeCount = countActive(filters, query)

  const buildVars = useCallback((targetPage) => {
    const vars = {
      type: filters.type,
      perPage: PER_PAGE,
      page: targetPage,
      isAdult: false,
      sort: [filters.sort],
    }
    if (query.trim()) vars.search = query.trim()
    if (filters.genres.length) vars.genre_in = filters.genres
    if (filters.formats.length) vars.format_in = filters.formats
    if (filters.status) vars.status = filters.status
    if (filters.year) vars.year = filters.year
    return vars
  }, [query, filters])

  const runSearch = useCallback(async (targetPage = 1, append = false) => {
    const myId = ++requestId.current
    append ? setLoadingMore(true) : setLoading(true)
    setError(false)
    setSearched(true)
    try {
      const { media, pageInfo } = await searchMedia(buildVars(targetPage))
      if (myId !== requestId.current) return // une recherche plus récente est partie entre-temps
      setResults(prev => append ? [...prev, ...media] : media)
      setHasNextPage(pageInfo.hasNextPage)
      setTotal(pageInfo.total)
      setPage(targetPage)
    } catch (e) {
      console.error('Explorer search error:', e)
      if (myId === requestId.current) { setError(true); if (!append) setResults([]) }
    }
    append ? setLoadingMore(false) : setLoading(false)
  }, [buildVars])

  // Debounce : la recherche se relance automatiquement quand la requête ou les filtres changent
  useEffect(() => {
    const hasCriteria = query.trim().length >= 2 || activeCount > 0 || searched
    if (!hasCriteria) return
    const t = setTimeout(() => runSearch(1, false), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filters])

  const toggleGenre = (g) => {
    setFilters(f => ({ ...f, genres: f.genres.includes(g) ? f.genres.filter(x => x !== g) : [...f.genres, g] }))
  }
  const toggleFormat = (fmt) => {
    setFilters(f => ({ ...f, formats: f.formats.includes(fmt) ? f.formats.filter(x => x !== fmt) : [...f.formats, fmt] }))
  }
  const setType = (type) => setFilters(f => ({ ...f, type, formats: [], genres: [] }))
  const resetFilters = () => { setFilters(DEFAULT_FILTERS); setQuery('') }

  const removeChip = (kind, value) => {
    if (kind === 'query') setQuery('')
    else if (kind === 'genre') toggleGenre(value)
    else if (kind === 'format') toggleFormat(value)
    else if (kind === 'status') setFilters(f => ({ ...f, status: '' }))
    else if (kind === 'year') setFilters(f => ({ ...f, year: '' }))
    else if (kind === 'sort') setFilters(f => ({ ...f, sort: DEFAULT_FILTERS.sort }))
  }

  const sortLabel = SORT_OPTIONS.find(s => s.value === filters.sort)?.label
  const statusLabel = STATUS_OPTIONS.find(s => s.value === filters.status)?.label

  return (
    <div className="scroll-area">
      <ScrollToTop />
      <div className="section-wrapper" style={{ paddingTop: '40px' }}>

        <div className="section-header">
          <div className="section-title"><i className="fas fa-compass"></i> Explorer</div>
          {total > 0 && !loading && <span className="section-count">{total.toLocaleString('fr-FR')} résultats</span>}
        </div>

        {/* ─── Barre de recherche + toggle Anime/Manga + bouton filtres ─── */}
        <div className="exp-toolbar">
          <div className="search-box exp-search-box">
            <i className="fas fa-search search-icon"></i>
            <input
              type="text"
              className="search-input"
              placeholder="Rechercher un titre..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && <i className="fas fa-times search-clear" onClick={() => setQuery('')}></i>}
          </div>

          <div className="exp-type-toggle">
            <button className={filters.type === 'ANIME' ? 'active' : ''} onClick={() => setType('ANIME')}>
              <i className="fas fa-tv"></i> Anime
            </button>
            <button className={filters.type === 'MANGA' ? 'active' : ''} onClick={() => setType('MANGA')}>
              <i className="fas fa-book"></i> Manga
            </button>
          </div>

          <button className={`exp-filter-toggle${panelOpen ? ' active' : ''}`} onClick={() => setPanelOpen(o => !o)}>
            <i className="fas fa-sliders"></i> Filtres
            {activeCount > 0 && <span className="exp-filter-badge">{activeCount}</span>}
          </button>
        </div>

        {/* ─── Panneau de filtres avancé ─── */}
        {panelOpen && (
          <div className="exp-panel">

            <div className="exp-panel-col">
              <p className="exp-panel-label"><i className="fas fa-arrow-down-wide-short"></i> Trier par</p>
              <div className="exp-chip-row">
                {SORT_OPTIONS.map(s => (
                  <button key={s.value} className={`filter-chip${filters.sort === s.value ? ' active' : ''}`}
                    onClick={() => setFilters(f => ({ ...f, sort: s.value }))}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="exp-panel-col">
              <p className="exp-panel-label"><i className="fas fa-shapes"></i> Format</p>
              <div className="exp-chip-row">
                {formatList.map(f => (
                  <button key={f.value} className={`filter-chip${filters.formats.includes(f.value) ? ' active' : ''}`}
                    onClick={() => toggleFormat(f.value)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="exp-panel-col">
              <p className="exp-panel-label"><i className="fas fa-satellite-dish"></i> Statut de diffusion</p>
              <div className="exp-chip-row">
                {STATUS_OPTIONS.map(s => (
                  <button key={s.value} className={`filter-chip${filters.status === s.value ? ' active' : ''}`}
                    onClick={() => setFilters(f => ({ ...f, status: f.status === s.value ? '' : s.value }))}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="exp-panel-col">
              <p className="exp-panel-label"><i className="fas fa-calendar"></i> Année</p>
              <YearPicker value={filters.year} onChange={y => setFilters(f => ({ ...f, year: y }))} />
            </div>

            <div className="exp-panel-col">
              <p className="exp-panel-label"><i className="fas fa-tags"></i> Genres</p>
              <div className="exp-chip-row">
                {genreList.map(g => (
                  <button key={g} className={`filter-chip${filters.genres.includes(g) ? ' active' : ''}`}
                    onClick={() => toggleGenre(g)}>
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="exp-panel-footer">
              <button className="exp-reset-btn" onClick={resetFilters} disabled={activeCount === 0}>
                <i className="fas fa-rotate-left"></i> Réinitialiser
              </button>
              <button className="btn btn-primary" onClick={() => setPanelOpen(false)}>
                Voir les résultats
              </button>
            </div>
          </div>
        )}

        {/* ─── Chips des filtres actifs (visibles même panneau fermé) ─── */}
        {activeCount > 0 && (
          <div className="exp-active-chips">
            {query && <span className="exp-active-chip">"{query}" <i className="fas fa-times" onClick={() => removeChip('query')}></i></span>}
            {filters.genres.map(g => (
              <span key={g} className="exp-active-chip">{g} <i className="fas fa-times" onClick={() => removeChip('genre', g)}></i></span>
            ))}
            {filters.formats.map(f => (
              <span key={f} className="exp-active-chip">
                {formatList.find(x => x.value === f)?.label || f} <i className="fas fa-times" onClick={() => removeChip('format', f)}></i>
              </span>
            ))}
            {filters.status && <span className="exp-active-chip">{statusLabel} <i className="fas fa-times" onClick={() => removeChip('status')}></i></span>}
            {filters.year && <span className="exp-active-chip">{filters.year} <i className="fas fa-times" onClick={() => removeChip('year')}></i></span>}
            {filters.sort !== DEFAULT_FILTERS.sort && (
              <span className="exp-active-chip">Tri : {sortLabel} <i className="fas fa-times" onClick={() => removeChip('sort')}></i></span>
            )}
          </div>
        )}

        {/* ─── États : chargement / erreur / vide / résultats ─── */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px' }}>
            <i className="fas fa-spinner" style={{ fontSize: '2rem', color: '#ff5500', animation: 'spin 1s linear infinite' }}></i>
          </div>
        )}

        {!loading && error && (
          <div className="empty-state">
            <i className="fas fa-triangle-exclamation"></i>
            <h3>Oups, la recherche a échoué</h3>
            <p>Le catalogue n&apos;a pas répondu correctement. Réessaie dans un instant.</p>
            <button className="btn btn-primary" onClick={() => runSearch(1, false)} style={{ marginTop: '16px' }}>
              <i className="fas fa-rotate-right"></i> Réessayer
            </button>
          </div>
        )}

        {!loading && !error && searched && results.length === 0 && (
          <div className="empty-state">
            <i className="fas fa-ghost"></i>
            <h3>Aucun résultat</h3>
            <p>Essaie d'élargir tes filtres ou un autre terme de recherche.</p>
          </div>
        )}

        {!loading && !error && !searched && results.length === 0 && (
          <div className="empty-state">
            <i className="fas fa-compass"></i>
            <h3>Lance une recherche ou ouvre les filtres</h3>
            <p>Tape un titre, choisis un genre, ou trie directement par score pour voir le classement.</p>
          </div>
        )}

        {!loading && results.length > 0 && (
          <>
            <div className="grid-cards">
              {results.map(anime => (
                <div key={anime.id} className="card" onClick={() => onOpenModal(anime)}>
                  <div className="card-img-container">
                    <img src={anime.coverImage?.extraLarge || anime.coverImage?.large} className="card-img" loading="lazy" alt={anime.title?.romaji} />
                    {anime.averageScore && <div className="score-badge">{(anime.averageScore / 10).toFixed(1)}</div>}
                    {anime.status === 'RELEASING' && (
                      <div className="airing-badge"><div className="airing-dot"></div> EN COURS</div>
                    )}
                  </div>
                  <div className="card-info">
                    <h3>{anime.title?.english || anime.title?.romaji}</h3>
                    <p>{anime.format || ''}</p>
                  </div>
                </div>
              ))}
            </div>

            {hasNextPage && (
              <div style={{ textAlign: 'center', marginTop: '32px' }}>
                <button className="btn btn-secondary" disabled={loadingMore} onClick={() => runSearch(page + 1, true)}>
                  {loadingMore
                    ? <><i className="fas fa-spinner" style={{ animation: 'spin 1s linear infinite' }}></i> Chargement...</>
                    : <>Charger plus <i className="fas fa-chevron-down"></i></>}
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}

export default Explorer