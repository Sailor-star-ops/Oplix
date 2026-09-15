import { useState, useEffect } from 'react'
import {
  stripHtml, formatDuration,
  FORMAT_LABELS, STATUS_LABELS, SEASON_LABELS, SOURCE_LABELS
} from '../lib/catalog'

const relTypeLabel = t => ({
  SEQUEL: 'Suite', PREQUEL: 'Préquelle', ALTERNATIVE: 'Alternatif',
  SIDE_STORY: 'Side story', PARENT: 'Œuvre mère', SUMMARY: 'Résumé',
  SPIN_OFF: 'Spin-off', OTHER: 'Autre', SOURCE: 'Source', COMPILATION: 'Compilation',
  CONTAINS: 'Contient',
}[t] || t)

const roleLabel = r => ({ MAIN: 'Principal', SUPPORTING: 'Secondaire', BACKGROUND: 'Figurant' }[r] || r)

/* Langue de doublage (données Anime News Network). La VF passe en premier
   dans le tri fait à l'import : c'est l'info que cherche un public français,
   et aucun autre catalogue ne l'expose. */
const voiceLangLabel = l => ({
  FR: 'VF', JA: 'VO', EN: 'VA', ES: 'ES', DE: 'DE', IT: 'IT',
  PT: 'PT', KO: 'KO', TL: 'TL', RU: 'RU',
}[l] || l)

/* Génère un fond très sombre teinté depuis n'importe quelle couleur hex.
   mix = 0..1 (proportion de la couleur, le reste est #080808)
   Résultat toujours sombre et cohérent, jamais criard. */
function subtleBg(hex, mix = 0.10) {
  if (!hex || hex[0] !== '#') return 'rgba(255,255,255,.04)'
  const h = hex.length === 4
    ? hex.slice(1).split('').map(c => parseInt(c + c, 16))
    : [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]
  if (h.some(isNaN)) return 'rgba(255,255,255,.04)'
  const base = 8 // #080808
  const r = Math.round(base + (h[0] - base) * mix)
  const g = Math.round(base + (h[1] - base) * mix)
  const b = Math.round(base + (h[2] - base) * mix)
  return `rgb(${r},${g},${b})`
}

function SectionTitle({ icon, children }) {
  return (
    <div className="mi-stitle">
      <i className={`fas ${icon}`} />
      <span>{children}</span>
    </div>
  )
}

function Modal({ anime, onClose }) {
  const [activeTab, setActiveTab] = useState('info')
  const [posterZoom, setPosterZoom] = useState(false)

  useEffect(() => {
    setActiveTab('info')
  }, [anime?.id])

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!anime) return null

  const totalEps = anime.episodes || anime.chapters || 0
  const ac       = anime.coverImage?.color || '#ff5500'

  const tabs = [
    { id: 'info',    label: 'Infos',       icon: 'fa-circle-info' },
    { id: 'chars',   label: 'Personnages', icon: 'fa-users'       },
    { id: 'related', label: 'Connexes',    icon: 'fa-link'        },
  ].filter(t => {
    if (t.id === 'chars')   return (anime.characters?.edges?.length || 0) > 0
    if (t.id === 'related') return (anime.relations?.edges?.length || 0) > 0 || (anime.recommendations?.nodes?.length || 0) > 0 || (anime.externalLinks?.length || 0) > 0
    return true
  })

  return (
    <div className="mi-overlay" onClick={posterZoom ? () => setPosterZoom(false) : onClose}>

      {/* ─── LIGHTBOX — en dehors du .mi pour ne pas être clippée par border-radius ─── */}
      {posterZoom && (
        <div className="mi__poster-lightbox" onClick={() => setPosterZoom(false)}>
          <div className="mi__poster-lightbox-inner" onClick={e => e.stopPropagation()}>
            <img
              src={anime.coverImage?.extraLarge || anime.coverImage?.large}
              alt={anime.title?.romaji}
            />
            <button className="mi__poster-lightbox-close" onClick={() => setPosterZoom(false)}>
              <i className="fas fa-times" />
            </button>
          </div>
        </div>
      )}

      <div className="mi" onClick={e => e.stopPropagation()} style={{ '--ac': ac }}>

        <button className="mi__close" onClick={onClose}><i className="fas fa-times" /></button>

        {/* ─── HERO (hauteur fixe, pas de scroll) ─── */}
        <div className="mi__hero">
          {/* Pas de bannerImage dédiée (source disparue avec AniList) : fond
              généré depuis la cover (flou) plutôt qu'étirée nette. */}
          <div
            className="mi__hero-bg"
            style={anime.coverImage?.extraLarge
              ? {
                  backgroundImage: `url(${anime.coverImage.extraLarge})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: 'blur(28px) brightness(0.6)',
                  transform: 'scale(1.15)',
                }
              : { background: `linear-gradient(135deg, ${ac}30 0%, #0d0d0d 100%)` }
            }
          />
          <div className="mi__hero-fade" />
          <div className="mi__hero-inner">
            <div className="mi__poster-wrap" onClick={() => setPosterZoom(true)}>
              <img
                src={anime.coverImage?.extraLarge || anime.coverImage?.large}
                className="mi__poster"
                alt={anime.title?.romaji}
              />
              <div className="mi__poster-zoom-btn">
                <i className="fas fa-magnifying-glass-plus" />
              </div>
            </div>
            <div className="mi__hero-text">
              <div className="mi__type-badge" style={{ background: `${ac}20`, color: ac, borderColor: `${ac}50` }}>
                {anime.type === 'MANGA' ? <i className="fas fa-book" /> : <i className="fas fa-tv" />}
                {FORMAT_LABELS[anime.format] || anime.type}
              </div>
              <h1 className="mi__title">{anime.title?.english || anime.title?.romaji}</h1>
              {anime.title?.native && anime.title.native !== anime.title?.romaji && (
                <div className="mi__title-jp">{anime.title.native}</div>
              )}
              <div className="mi__pills">
                {anime.averageScore && (
                  <span className="mi__pill mi__pill--score"><i className="fas fa-star" /> {(anime.averageScore / 10).toFixed(1)}</span>
                )}
                <span className="mi__pill">{STATUS_LABELS[anime.status] || anime.status}</span>
                {anime.episodes  && <span className="mi__pill">{anime.episodes} ép.</span>}
                {anime.chapters  && <span className="mi__pill">{anime.chapters} ch.</span>}
                {anime.duration  && <span className="mi__pill">{formatDuration(anime.duration)}/ép.</span>}
                {anime.seasonYear && <span className="mi__pill">{SEASON_LABELS[anime.season]} {anime.seasonYear}</span>}
              </div>
              <div className="mi__genres">
                {anime.genres?.slice(0, 5).map(g => <span key={g} className="mi__genre">{g}</span>)}
              </div>
            </div>
          </div>
        </div>

        {/* ─── BODY (scroll) ─── */}
        <div className="mi__body">

          {/* Sidebar — désormais purement informative.
              Les actions (statut, note, progression, suppression, trailer)
              vivent maintenant dans le menu radial (AnimeWheel.jsx). */}
          <div className="mi__sidebar">
            {anime.nextAiringEpisode && (
              <div className="mi__next-ep" style={{ borderColor: `${ac}35`, background: subtleBg(ac, 0.12) }}>
                <div className="mi__next-dot" style={{ background: ac, boxShadow: `0 0 8px ${ac}` }} />
                <div>
                  <div className="mi__next-label">Prochain · Ép. {anime.nextAiringEpisode.episode}</div>
                  <div className="mi__next-time">
                    {(() => {
                      const s = anime.nextAiringEpisode.timeUntilAiring
                      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
                      return d > 0 ? `Dans ${d}j ${h}h` : h > 0 ? `Dans ${h}h ${m}m` : `Dans ${m}min`
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Contenu principal */}
          <div className="mi__content">
            <div className="mi__tabs">
              {tabs.map(t => (
                <button
                  key={t.id}
                  className={`mi__tab${activeTab === t.id ? ' active' : ''}`}
                  style={activeTab === t.id ? { color: ac, borderBottomColor: ac } : {}}
                  onClick={() => setActiveTab(t.id)}
                >
                  <i className={`fas ${t.icon}`} />{t.label}
                </button>
              ))}
            </div>

            {activeTab === 'info' && (
              <div className="mi__pane">

                {/* ─── Ordre de visionnage — visible sans clic, si l'œuvre fait partie d'une suite ─── */}
                {(() => {
                  const prequels = anime.relations?.edges?.filter(e => e.relationType === 'PREQUEL') || []
                  const sequels  = anime.relations?.edges?.filter(e => e.relationType === 'SEQUEL')  || []
                  if (prequels.length === 0 && sequels.length === 0) return null
                  return (
                    <div className="mi__order">
                      <div className="mi__order-label"><i className="fas fa-list-ol" /> Ordre de visionnage</div>
                      <div className="mi__order-chain">
                        {prequels.map((e, i) => (
                          <div key={`p${i}`} className="mi__order-item">
                            <img src={e.node?.coverImage?.large} alt="" />
                            <span>{e.node?.title?.english || e.node?.title?.romaji}</span>
                          </div>
                        ))}
                        {prequels.length > 0 && <i className="fas fa-arrow-right mi__order-arrow" />}
                        <div className="mi__order-item mi__order-item--current">
                          <img src={anime.coverImage?.large} alt="" />
                          <span>{anime.title?.english || anime.title?.romaji} <em>(cet anime)</em></span>
                        </div>
                        {sequels.length > 0 && <i className="fas fa-arrow-right mi__order-arrow" />}
                        {sequels.map((e, i) => (
                          <div key={`s${i}`} className="mi__order-item">
                            <img src={e.node?.coverImage?.large} alt="" />
                            <span>{e.node?.title?.english || e.node?.title?.romaji}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {anime.description && (
                  <div className="mi__block">
                    <SectionTitle icon="fa-align-left">Synopsis</SectionTitle>
                    <p className="mi__synopsis">{stripHtml(anime.description, 900)}</p>
                  </div>
                )}
                <div className="mi__stats-grid">
                  {[
                    { l: 'Score',      v: anime.averageScore  ? (anime.averageScore / 10).toFixed(1) + '/10' : null, icon: 'fa-star',            ic: '#fbbf24' },
                    { l: 'Membres',    v: anime.popularity     ? anime.popularity.toLocaleString('fr-FR') : null,      icon: 'fa-users',          ic: '#f97316' },
                    { l: 'Classement', v: anime.popularityRank ? '#' + anime.popularityRank.toLocaleString('fr-FR') : null, icon: 'fa-ranking-star', ic: '#fbbf24' },
                    { l: 'Favoris',    v: anime.favourites    ? anime.favourites.toLocaleString('fr-FR') : null,       icon: 'fa-heart',          ic: '#f43f5e' },
                    { l: 'Épisodes',   v: anime.episodes      || null,                                                  icon: 'fa-clapperboard',   ic: '#60a5fa' },
                    { l: 'Chapitres',  v: anime.chapters      || null,                                                  icon: 'fa-book-open',      ic: '#34d399' },
                    { l: 'Volumes',    v: anime.volumes       || null,                                                  icon: 'fa-layer-group',    ic: '#a78bfa' },
                    { l: 'Durée/ép.',  v: anime.duration      ? formatDuration(anime.duration) : null,                  icon: 'fa-clock',          ic: '#38bdf8' },
                    { l: 'Source',     v: SOURCE_LABELS[anime.source] || anime.source || null,                          icon: 'fa-code-branch',    ic: '#fb923c' },
                    { l: 'Début',      v: anime.startDate?.year ? [anime.startDate.day, anime.startDate.month, anime.startDate.year].filter(Boolean).join('/') : null, icon: 'fa-calendar-plus',  ic: '#4ade80' },
                    { l: 'Fin',        v: anime.endDate?.year   ? [anime.endDate.day, anime.endDate.month, anime.endDate.year].filter(Boolean).join('/') : null,       icon: 'fa-calendar-check', ic: '#94a3b8' },
                    { l: 'Pays',       v: anime.countryOfOrigin || null,                                                icon: 'fa-earth-asia',     ic: '#e2e8f0' },
                  ].filter(s => s.v).map(s => (
                    <div className="mi__stat" key={s.l}>
                      <i className={`fas ${s.icon}`} style={{ color: s.ic, fontSize: '.7rem', marginBottom: 4 }} />
                      <span className="mi__stat-v">{s.v}</span>
                      <span className="mi__stat-l">{s.l}</span>
                    </div>
                  ))}
                </div>
                {anime.studios?.nodes?.length > 0 && (
                  <div className="mi__block">
                    <SectionTitle icon={anime.type === 'MANGA' ? 'fa-pen-nib' : 'fa-building'}>
                      {anime.type === 'MANGA' ? 'Auteur(s)' : 'Studios'}
                    </SectionTitle>
                    <div className="mi__chip-row">
                      {anime.studios.nodes.map(s => (
                        <span key={s.id} className="mi__chip" style={{ borderColor: `${ac}35`, color: ac }}>
                          {s.isAnimationStudio && <i className="fas fa-star" style={{ fontSize: '.5rem' }} />}
                          {s.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {anime.staff?.edges?.length > 0 && (
                  <div className="mi__block">
                    <SectionTitle icon="fa-user-tie">Équipe</SectionTitle>
                    <div className="mi__staff-grid">
                      {anime.staff.edges.map((e, i) => (
                        <div className="mi__staff-card" key={i}>
                          <img src={e.node?.image?.medium} alt="" onError={ev => ev.target.style.display = 'none'} />
                          <div>
                            <div className="mi__staff-name">{e.node?.name?.full}</div>
                            <div className="mi__staff-role">{e.role}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {anime.tags?.length > 0 && (
                  <div className="mi__block">
                    <SectionTitle icon="fa-tags">Tags</SectionTitle>
                    <div className="mi__tag-row">
                      {anime.tags.filter(t => !t.isMediaSpoiler).slice(0, 18).map(t => (
                        <span key={t.name} className="mi__tag" title={t.category}
                          style={{ opacity: 0.35 + (t.rank / 100) * 0.65 }}>
                          {t.name}<em>{t.rank}%</em>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'chars' && (
              <div className="mi__pane">
                <div className="mi__chars-grid">
                  {anime.characters?.edges?.map((e, i) => (
                    <div className="mi__char-card" key={i}>
                      {/* Anime News Network fournit les noms sans portraits :
                          on n'affiche le bloc image que s'il y a vraiment
                          quelque chose à montrer, plutôt qu'une vignette cassée. */}
                      {(e.node?.image?.large || e.voiceActors?.[0]?.image?.medium) && (
                        <div className="mi__char-imgs">
                          {e.node?.image?.large && (
                            <img className="mi__char-img" src={e.node.image.large} alt={e.node?.name?.full}
                              onError={ev => ev.target.style.display = 'none'} />
                          )}
                          {e.voiceActors?.[0]?.image?.medium && (
                            <img className="mi__va-img" src={e.voiceActors[0].image.medium}
                              alt={e.voiceActors[0].name?.full} title={e.voiceActors[0].name?.full}
                              onError={ev => ev.target.style.display = 'none'} />
                          )}
                        </div>
                      )}
                      <div>
                        <div className="mi__char-name">{e.node?.name?.full}</div>
                        <div className="mi__char-role" style={e.role === 'MAIN' ? { color: ac } : {}}>{roleLabel(e.role)}</div>
                        {e.voiceActors?.[0] && (
                          <div className="mi__char-va">
                            {e.voiceActors[0].name?.full}
                            {e.voiceActors[0].language && (
                              <em className="mi__char-lang">{voiceLangLabel(e.voiceActors[0].language)}</em>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'related' && (
              <div className="mi__pane">
                {anime.relations?.edges?.length > 0 && (
                  <div className="mi__block">
                    <SectionTitle icon="fa-link">Œuvres liées</SectionTitle>
                    <div className="mi__media-grid">
                      {anime.relations.edges.map((e, i) => (
                        <div className="mi__media-card" key={i}>
                          <div className="mi__media-img"><img src={e.node?.coverImage?.large} alt="" /></div>
                          <div className="mi__media-info">
                            <div className="mi__media-type">{relTypeLabel(e.relationType)}</div>
                            <div className="mi__media-title">{e.node?.title?.english || e.node?.title?.romaji}</div>
                            <div className="mi__media-meta">{FORMAT_LABELS[e.node?.format] || e.node?.format}{e.node?.episodes && ` · ${e.node.episodes} ép.`}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {anime.recommendations?.nodes?.filter(n => n.mediaRecommendation).length > 0 && (
                  <div className="mi__block">
                    <SectionTitle icon="fa-thumbs-up">Recommandations</SectionTitle>
                    <div className="mi__media-grid">
                      {anime.recommendations.nodes.filter(n => n.mediaRecommendation).map((n, i) => (
                        <div className="mi__media-card" key={i}>
                          <div className="mi__media-img"><img src={n.mediaRecommendation.coverImage?.large} alt="" /></div>
                          <div className="mi__media-info">
                            <div className="mi__media-type" style={{ color: '#fbbf24' }}>
                              <i className="fas fa-heart" style={{ fontSize: '.55rem' }} /> {n.rating} votes
                            </div>
                            <div className="mi__media-title">{n.mediaRecommendation.title?.english || n.mediaRecommendation.title?.romaji}</div>
                            <div className="mi__media-meta">
                              {FORMAT_LABELS[n.mediaRecommendation.format]}
                              {n.mediaRecommendation.episodes && ` · ${n.mediaRecommendation.episodes} ép.`}
                              {n.mediaRecommendation.averageScore && ` · ★ ${(n.mediaRecommendation.averageScore / 10).toFixed(1)}`}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {anime.externalLinks?.length > 0 && (
                  <div className="mi__block">
                    <SectionTitle icon="fa-external-link-alt">Liens officiels</SectionTitle>
                    <div className="mi__ext-links">
                      {anime.externalLinks.map((lnk, i) => (
                        <a key={i} href={lnk.url} target="_blank" rel="noopener noreferrer"
                          className="mi__ext-link" style={lnk.color ? { '--lc': lnk.color } : {}}>
                          <i className="fas fa-arrow-up-right-from-square" />{lnk.site}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Attribution des sources. Les conditions d'utilisation d'Anime
                News Network imposent de les citer comme source ET de lier la
                fiche d'origine sur toute page affichant leurs données — ce
                bloc n'est donc pas décoratif, il est contractuel. */}
            <div className="mi__sources">
              {anime.copyrightNotice && (
                <div className="mi__copyright">{anime.copyrightNotice}</div>
              )}
              <div className="mi__credit">
                Données&nbsp;:
                {anime.siteUrl ? (
                  <a href={anime.siteUrl} target="_blank" rel="noopener noreferrer">
                    Anime News Network
                  </a>
                ) : (
                  <span>MyAnimeList</span>
                )}
                {anime.siteUrl && <span> · fiche complète sur ANN</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Modal