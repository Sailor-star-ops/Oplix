import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { buildEpisodeList } from '../lib/anilist'
import Modal from './Modal'

/* ─── Géométrie du donut (secteurs façon roue GTA) ──────────────────
   angle 0 = haut, sens horaire. 4 positions fixes : haut / droite / bas / gauche
──────────────────────────────────────────────────────────────────── */
const CX = 200, CY = 200
const OUTER_R = 190
const INNER_R = 92
const GAP = 3 // degrés de marge entre secteurs

function polar(r, angleDeg) {
  const rad = (angleDeg - 0) * Math.PI / 180
  return { x: CX + r * Math.sin(rad), y: CY - r * Math.cos(rad) }
}

function sectorPath(startAngle, endAngle, innerR = INNER_R, outerR = OUTER_R) {
  const large = endAngle - startAngle > 180 ? 1 : 0
  const p1 = polar(outerR, startAngle)
  const p2 = polar(outerR, endAngle)
  const p3 = polar(innerR, endAngle)
  const p4 = polar(innerR, startAngle)
  return `M ${p1.x} ${p1.y} A ${outerR} ${outerR} 0 ${large} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${innerR} ${innerR} 0 ${large} 0 ${p4.x} ${p4.y} Z`
}

/* ─── Wheel générique : dessine n secteurs à partir d'une liste d'items ── */
function Wheel({ items, hoverIndex, setHoverIndex, onPick, accent }) {
  const n = items.length
  const slice = 360 / n
  return (
    <svg viewBox="0 0 400 400" className="aw-svg">
      {items.map((it, i) => {
        const center = i * slice
        const start = center - slice / 2 + GAP
        const end = center + slice / 2 - GAP
        const mid = polar((INNER_R + OUTER_R) / 2, center)
        const hovered = hoverIndex === i
        return (
          <g
            key={it.key || i}
            className={`aw-slice${hovered ? ' aw-slice--hover' : ''}${it.active ? ' aw-slice--active' : ''}`}
            onMouseEnter={() => setHoverIndex(i)}
            onMouseLeave={() => setHoverIndex(null)}
            onClick={() => onPick(it, i)}
          >
            <path d={sectorPath(start, end)} style={hovered || it.active ? { fill: `${it.color || accent}22`, stroke: it.color || accent } : {}} />
            <foreignObject x={mid.x - 48} y={mid.y - 28} width="96" height="56">
              <div className="aw-slice-content" style={hovered || it.active ? { color: it.color || accent } : {}}>
                <i className={`fas ${it.icon}`} />
                <span>{it.label}</span>
              </div>
            </foreignObject>
          </g>
        )
      })}
    </svg>
  )
}

function AnimeWheel({
  anime, onClose, onOpenPlayer,
  onAddToList, onRemoveFromList,
  getItemStatus, getItemRating, getItemProgress,
  onSetRating, onSetProgress,
  user, onAuthOpen,
}) {
  const [mode, setMode] = useState('main') // main | liste | note | apercu | infos
  const [hoverIndex, setHoverIndex] = useState(null)
  const [noteText, setNoteText] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const [epLogs, setEpLogs] = useState({})       // { [episode]: { watched, rating, comment } }
  const [episodesOpen, setEpisodesOpen] = useState(false)
  const [openComment, setOpenComment] = useState(null)

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') (mode === 'main' ? onClose() : setMode('main')) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mode, onClose])

  useEffect(() => {
    if (!user || !anime?.id) { setEpLogs({}); return }
    supabase.from('episode_logs').select('*').eq('user_id', user.id).eq('anilist_id', anime.id)
      .then(({ data }) => {
        const map = {}
        ;(data || []).forEach(l => { map[l.episode] = l })
        setEpLogs(map)
      })
  }, [user, anime?.id])

  if (!anime) return null

  const ac             = anime.coverImage?.color || '#ff5500'
  const currentStatus   = getItemStatus(anime.id)
  const currentRating   = getItemRating(anime.id)
  const currentProgress = getItemProgress ? getItemProgress(anime.id) : 0
  const totalEps        = anime.episodes || anime.chapters || 0
  const progressPct     = totalEps > 0 ? Math.min(100, (currentProgress / totalEps) * 100) : 0
  const episodeList     = buildEpisodeList(anime)

  const saveEpisodeLog = async (episode, patch) => {
    if (!user) { onAuthOpen?.(); return }
    const prev = epLogs[episode] || {}
    const next = { ...prev, ...patch }
    setEpLogs(m => ({ ...m, [episode]: next })) // optimiste
    try {
      await supabase.from('episode_logs').upsert({
        user_id: user.id, anilist_id: anime.id, episode,
        watched: next.watched ?? false, rating: next.rating ?? null, comment: next.comment ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,anilist_id,episode' })
    } catch (e) { console.error('saveEpisodeLog error:', e) }
  }

  const mainItems = [
    { key: 'infos',  icon: 'fa-circle-info', label: 'Infos' },
    { key: 'liste',  icon: 'fa-list-ul',      label: 'Liste', active: !!currentStatus, color: currentStatus ? ac : null },
    { key: 'note',   icon: 'fa-pen',          label: 'Note', active: noteSaved, color: noteSaved ? '#8b5cf6' : null },
    { key: 'apercu', icon: 'fa-play',         label: 'Aperçu' },
  ]

  const statusItems = [
    { key: 'watching',      icon: 'fa-play',     label: 'En cours',  color: ac,        active: currentStatus === 'watching' },
    { key: 'completed',     icon: 'fa-check',    label: 'Terminé',   color: '#4ade80', active: currentStatus === 'completed' },
    { key: 'plan_to_watch', icon: 'fa-bookmark', label: 'À voir',    color: '#8b5cf6', active: currentStatus === 'plan_to_watch' },
    { key: 'dropped',       icon: 'fa-xmark',    label: 'Abandonné', color: '#ef4444', active: currentStatus === 'dropped' },
  ]

  const handleMainPick = (it) => {
    if (!user && it.key !== 'infos' && it.key !== 'apercu') {
      onClose()
      onAuthOpen()
      return
    }
    setHoverIndex(null)
    setMode(it.key)
  }

  const handleStatusPick = (it) => {
    onAddToList(anime, it.key)
  }

  const centerLabel = hoverIndex !== null ? mainItems[hoverIndex].label : (anime.title?.english || anime.title?.romaji)

  return createPortal(
    <div className="aw-overlay" onClick={() => (mode === 'main' ? onClose() : setMode('main'))}>
      <div className="aw-topbar" onClick={e => e.stopPropagation()}>
        {mode !== 'main' && (
          <button className="aw-back" onClick={() => setMode('main')}><i className="fas fa-chevron-left" /> Retour</button>
        )}
        <button className="aw-close" onClick={onClose}><i className="fas fa-times" /></button>
      </div>

      {mode === 'infos' ? (
        <div onClick={e => e.stopPropagation()}>
          <Modal anime={anime} onClose={onClose} />
        </div>
      ) : (
        <div className="aw-stage" onClick={e => e.stopPropagation()}>

          {mode === 'main' && (
            <div className="aw-wrap">
              <Wheel items={mainItems} hoverIndex={hoverIndex} setHoverIndex={setHoverIndex} onPick={handleMainPick} accent={ac} />

              <div className="aw-center">
                {(anime.coverImage?.extraLarge || anime.coverImage?.large) ? (
                  <img className="aw-center-img" src={anime.coverImage.extraLarge || anime.coverImage.large} alt="" />
                ) : (
                  <div className="aw-center-img aw-center-fallback" style={{ background: `linear-gradient(135deg, ${ac}55, #0d0d0d)` }}>
                    <i className="fas fa-meteor" />
                  </div>
                )}
                <div className="aw-center-fade" />
                <div className="aw-center-label">{centerLabel}</div>
              </div>
            </div>
          )}

          {/* ─── Carte "Liste" : liste verticale, volontairement différente de la roue ─── */}
          {mode === 'liste' && (
            <div className="aw-card aw-list-card">
              <div className="aw-card-head">
                <img src={anime.coverImage?.large} alt="" />
                <span>{anime.title?.english || anime.title?.romaji}</span>
              </div>

              <div className="aw-list-rows">
                {statusItems.map(it => (
                  <button
                    key={it.key}
                    className={`aw-list-row${it.active ? ' aw-list-row--active' : ''}`}
                    style={it.active ? { borderColor: it.color, color: it.color } : {}}
                    onClick={() => handleStatusPick(it)}
                  >
                    <span className="aw-list-row-icon" style={it.active ? { background: `${it.color}22`, color: it.color } : {}}>
                      <i className={`fas ${it.icon}`} />
                    </span>
                    <span className="aw-list-row-label">{it.label}</span>
                    {it.active && <i className="fas fa-check aw-list-row-check" style={{ color: it.color }} />}
                  </button>
                ))}
              </div>

              {currentStatus ? (
                <div className="aw-list-details">
                  {(currentStatus === 'watching' || currentStatus === 'dropped') && (
                    <div className="aw-panel-row">
                      <span className="aw-panel-label">Progression <b style={{ color: ac }}>{currentProgress}{totalEps > 0 ? `/${totalEps}` : ''}</b></span>
                      <div className="aw-prog-track"><div className="aw-prog-fill" style={{ width: `${progressPct}%`, background: ac }} /></div>
                      <div className="aw-prog-btns">
                        <button onClick={() => onSetProgress?.(anime.id, Math.max(0, currentProgress - 1))}>−</button>
                        <button onClick={() => onSetProgress?.(anime.id, currentProgress + 1)}>+</button>
                      </div>
                    </div>
                  )}

                  {episodeList.length > 0 && (
                    <div className="aw-panel-row">
                      <button className="aw-ep-toggle" onClick={() => setEpisodesOpen(o => !o)}>
                        <i className="fas fa-clapperboard" /> Détail par épisode ({episodeList.length})
                        <i className={`fas fa-chevron-${episodesOpen ? 'up' : 'down'} aw-ep-toggle-chev`} />
                      </button>

                      {episodesOpen && (
                        <div className="aw-ep-list">
                          {episodeList.map(ep => {
                            const log = epLogs[ep.num] || {}
                            const commentOpen = openComment === ep.num
                            return (
                              <div key={ep.num} className={`aw-ep-row${log.watched ? ' aw-ep-row--watched' : ''}${!ep.thumbnail ? ' aw-ep-row--plain' : ''}`}>
                                <button className="aw-ep-check" onClick={() => saveEpisodeLog(ep.num, { watched: !log.watched })}>
                                  <i className={`fas ${log.watched ? 'fa-circle-check' : 'fa-circle'}`} />
                                </button>
                                {ep.thumbnail ? (
                                  <div className="aw-ep-thumb"><img src={ep.thumbnail} alt="" /></div>
                                ) : (
                                  <div className="aw-ep-num-badge">{ep.num}</div>
                                )}
                                <div className="aw-ep-body">
                                  {ep.title && <div className="aw-ep-title">{ep.title}</div>}
                                  <div className="aw-ep-row-bottom">
                                    <div className="aw-ep-stars">
                                      {[1,2,3,4,5].map(n => (
                                        <i key={n} className={`fas fa-star${n <= (log.rating||0) ? ' aw-ep-star-on' : ''}`}
                                          onClick={() => saveEpisodeLog(ep.num, { rating: log.rating === n ? null : n })} />
                                      ))}
                                    </div>
                                    <button className="aw-ep-comment-btn" onClick={() => setOpenComment(commentOpen ? null : ep.num)}>
                                      <i className={`fas ${log.comment ? 'fa-comment-dots' : 'fa-comment'}`} />
                                    </button>
                                    {ep.url && (
                                      <a href={ep.url} target="_blank" rel="noopener noreferrer" className="aw-ep-watchlink" onClick={e => e.stopPropagation()}>
                                        {ep.site} <i className="fas fa-arrow-up-right-from-square" />
                                      </a>
                                    )}
                                  </div>
                                  {commentOpen && (
                                    <textarea
                                      className="aw-ep-comment-box"
                                      placeholder="Une pensée sur cet épisode..."
                                      defaultValue={log.comment || ''}
                                      onBlur={e => saveEpisodeLog(ep.num, { comment: e.target.value.trim() || null })}
                                      autoFocus
                                    />
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="aw-panel-row">
                    <span className="aw-panel-label">Note {currentRating > 0 && <b style={{ color: '#fbbf24' }}>{currentRating}/10</b>}</span>
                    <div className="aw-stars">
                      {[1,2,3,4,5,6,7,8,9,10].map(n => (
                        <i key={n} className={`fas fa-star${n <= currentRating ? ' aw-star-on' : ''}`} onClick={() => onSetRating(anime.id, n)} />
                      ))}
                    </div>
                  </div>
                  <button className="aw-remove-btn" onClick={() => { onRemoveFromList(anime.id); setMode('main') }}>
                    <i className="fas fa-trash" /> Retirer de ma liste
                  </button>
                </div>
              ) : (
                <p className="aw-panel-hint" style={{ textAlign: 'center', marginTop: '4px' }}>Choisis un statut ci-dessus pour débloquer la note et la progression.</p>
              )}
            </div>
          )}

          {/* ─── Carte "Note perso" ─── */}
          {mode === 'note' && (
            <div className="aw-card">
              <div className="aw-card-head">
                <img src={anime.coverImage?.large} alt="" />
                <span>{anime.title?.english || anime.title?.romaji}</span>
              </div>
              <textarea
                className="aw-note-input"
                placeholder="Ex : épisode 12, plus rien compris mais j'adore mdr"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                autoFocus
              />
              <button className="aw-save-btn" style={{ background: ac }} onClick={() => { setNoteSaved(true); setMode('main') }}>
                <i className="fas fa-check" /> Enregistrer
              </button>
              <p className="aw-panel-hint">Pour l'instant cette note reste locale à ta session — la persistance arrive en V1.1.</p>
            </div>
          )}

          {/* ─── Carte "Aperçu" ─── */}
          {mode === 'apercu' && (
            <div className="aw-card">
              <div className="aw-card-head">
                <img src={anime.coverImage?.large} alt="" />
                <span>{anime.title?.english || anime.title?.romaji}</span>
              </div>
              <div className="aw-preview-box">
                {anime.trailer?.site === 'youtube'
                  ? <img src={`https://i.ytimg.com/vi/${anime.trailer.id}/hqdefault.jpg`} alt="" />
                  : <i className="fas fa-video-slash" />}
              </div>
              <button className="aw-save-btn" style={{ background: ac }} onClick={() => onOpenPlayer(anime)}>
                <i className="fas fa-expand" /> Voir en plein écran
              </button>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  )
}

export default AnimeWheel