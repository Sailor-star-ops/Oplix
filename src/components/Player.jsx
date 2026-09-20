import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

function Player({ anime, onClose }) {
  const ytPlayerRef = useRef(null)
  const [embedError, setEmbedError] = useState(false)
  const [loading, setLoading] = useState(true)

  const trailerId = anime?.trailer?.site === 'youtube' ? anime.trailer.id : null
  const unavailable = !trailerId || embedError
  const ac = anime?.coverImage?.color || '#ff5500'

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    if (!trailerId) { setLoading(false); return }
    let cancelled = false

    const initPlayer = () => {
      if (cancelled) return
      if (!window.YT || !window.YT.Player) {
        setTimeout(initPlayer, 200)
        return
      }
      const container = document.getElementById('yt-player-container')
      if (!container) return
      container.innerHTML = '<div id="yt-player"></div>'

      ytPlayerRef.current = new window.YT.Player('yt-player', {
        videoId: trailerId,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady(e) { e.target.playVideo(); setLoading(false) },
          onError(e) {
            if ([2, 5, 101, 150].includes(e.data)) {
              setEmbedError(true)
              setLoading(false)
            }
          }
        }
      })
    }

    initPlayer()

    return () => {
      cancelled = true
      if (ytPlayerRef.current) {
        try { ytPlayerRef.current.stopVideo(); ytPlayerRef.current.destroy() } catch {
          // Le lecteur YouTube est deja detruit : rien a faire.
        }
        ytPlayerRef.current = null
      }
    }
  }, [trailerId])

  return createPortal(
    <div className="vp-interface" style={{ '--vp-ac': ac }}>

      {/* Header */}
      <div className="vp-header">
        <button className="vp-back-btn" onClick={onClose}>
          <i className="fas fa-arrow-left" /><span>Retour</span>
        </button>
        <div className="vp-header-center">
          <span className="vp-brand"><i className="fas fa-meteor" /> OPLIX</span>
          <span className="vp-divider">·</span>
          <span className="vp-label">{unavailable ? 'Trailer indisponible' : loading ? 'Chargement…' : 'Trailer officiel'}</span>
        </div>
        <div className="vp-header-right">
          <span className="vp-anime-title">{anime?.title?.english || anime?.title?.romaji || ''}</span>
        </div>
      </div>

      {/* Player YouTube */}
      {!unavailable && (
        <div className="vp-center">
          {loading && (
            <div className="vp-loading">
              <i className="fas fa-meteor vp-loading-icon" />
              <i className="fas fa-spinner vp-spinner" />
              <p>Chargement du trailer…</p>
            </div>
          )}
          <div id="yt-player-container" className="vp-yt-container" />
        </div>
      )}

      {/* Écran indisponible */}
      {unavailable && (
        <div className="vp-center vp-center--unavailable">
          <div className="vp-bg" style={{ backgroundImage: `url(${anime?.bannerImage || anime?.coverImage?.extraLarge || ''})` }} />
          <div className="vp-bg-fade" />
          <div className="vp-unavailable-content">
            <i className="fas fa-meteor vp-unavailable-icon" />
            <div className="vp-unavailable-title">Trailer indisponible</div>
            <p className="vp-unavailable-text">Ce trailer ne peut pas être intégré sur Oplix.</p>
            <button className="btn btn-primary" onClick={onClose}>
              <i className="fas fa-arrow-left" /> Retour
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

export default Player