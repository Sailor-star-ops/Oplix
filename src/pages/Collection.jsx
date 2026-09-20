import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { searchMedia } from '../lib/catalog'
import ScrollToTop from '../components/ScrollToTop'

const STATUS_TABS = [
  { value: 'all', label: 'Tout' },
  { value: 'watching', label: 'En cours' },
  { value: 'completed', label: 'Terminé' },
  { value: 'plan_to_watch', label: 'À regarder' },
  { value: 'dropped', label: 'Abandonné' },
]

const TEMPLATES = [
  { title: 'Wishlist',              icon: 'fa-gift',        color: '#8b5cf6', description: "Les animés/mangas que j'ai vraiment envie de découvrir" },
  { title: 'Coups de cœur',         icon: 'fa-heart',        color: '#ef4444', description: 'Mes préférés, ceux que je recommande les yeux fermés' },
  { title: 'Commencé avec quelqu\'un', icon: 'fa-user-group', color: '#22d3ee', description: 'À regarder ensemble, pas d\'épisode sans l\'autre !' },
  { title: 'Comfort watch',         icon: 'fa-mug-hot',      color: '#fbbf24', description: 'Pour les jours où j\'ai besoin de familier' },
  { title: 'À faire découvrir',     icon: 'fa-bullhorn',     color: '#4ade80', description: 'Ceux que je conseille à mes amis en premier' },
]

const COLOR_PRESETS = ['#ff5500', '#ef4444', '#fbbf24', '#4ade80', '#22d3ee', '#8b5cf6', '#ec4899']
const ICON_PRESETS = ['fa-layer-group', 'fa-heart', 'fa-gift', 'fa-star', 'fa-user-group', 'fa-mug-hot', 'fa-bullhorn', 'fa-bookmark', 'fa-fire', 'fa-clover']

function statusLabel(s) {
  return { watching: 'En cours', completed: 'Terminé', plan_to_watch: 'À regarder', dropped: 'Abandonné' }[s] || s
}
function statusClass(s) {
  return { watching: 'status-watching', completed: 'status-completed', plan_to_watch: 'status-plan', dropped: 'status-dropped' }[s] || ''
}

/* ─── Collage auto façon Spotify : jusqu'à 4 covers en grille ─── */
function CollectionCover({ items, icon, color }) {
  const covers = items.slice(0, 4).map(i => i.image).filter(Boolean)
  if (covers.length === 0) {
    return (
      <div className="col-cover col-cover--empty" style={{ background: `linear-gradient(135deg, ${color}55, #0d0d0f)` }}>
        <i className={`fas ${icon}`} style={{ color }} />
      </div>
    )
  }
  if (covers.length === 1) {
    return <div className="col-cover"><img src={covers[0]} alt="" /></div>
  }
  return (
    <div className="col-cover col-cover--grid">
      {covers.map((c, i) => <img key={i} src={c} alt="" />)}
      {covers.length < 4 && Array.from({ length: 4 - covers.length }).map((_, i) => (
        <div key={`ph${i}`} className="col-cover-ph" style={{ background: `${color}18` }} />
      ))}
    </div>
  )
}

function Collection({ watchlist, onOpenModal, user, onAuthOpen }) {
  const [view, setView] = useState('suivi') // suivi | collections
  const [activeTab, setActiveTab] = useState('all')

  /* ─── Collections perso ─── */
  const [collections, setCollections] = useState([])
  const [colLoading, setColLoading] = useState(false)
  const [openCollection, setOpenCollection] = useState(null) // objet collection ouverte en détail
  const [createOpen, setCreateOpen] = useState(false)

  const loadCollections = useCallback(async () => {
    if (!user) return
    setColLoading(true)
    try {
      const { data: cols, error } = await supabase
        .from('collections')
        .select('*, collection_items(*)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      setCollections(cols || [])
    } catch (e) {
      console.error('loadCollections error:', e)
    }
    setColLoading(false)
  }, [user])

  useEffect(() => { if (view === 'collections' && user) loadCollections() }, [view, user, loadCollections])

  useEffect(() => {
    if (openCollection) {
      const fresh = collections.find(c => c.id === openCollection.id)
      if (fresh) setOpenCollection(fresh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections])

  const filtered = activeTab === 'all' ? watchlist : watchlist.filter(w => w.status === activeTab)

  /* ─── CRUD collections ─── */
  const createCollection = async (payload) => {
    if (!user) { onAuthOpen(); return }
    try {
      const { data, error } = await supabase
        .from('collections')
        .insert({ user_id: user.id, ...payload })
        .select('*, collection_items(*)')
        .single()
      if (error) throw error
      setCollections(prev => [data, ...prev])
      setCreateOpen(false)
      setOpenCollection(data)
    } catch (e) {
      console.error('createCollection error:', e)
      alert("Impossible de créer la collection. Vérifie que la table 'collections' existe bien dans Supabase (voir supabase_migration_collections.sql).")
    }
  }

  const deleteCollection = async (col) => {
    if (!confirm(`Supprimer "${col.title}" ? Cette action est irréversible.`)) return
    try {
      await supabase.from('collections').delete().eq('id', col.id)
      setCollections(prev => prev.filter(c => c.id !== col.id))
      setOpenCollection(null)
    } catch (e) { console.error('deleteCollection error:', e) }
  }

  const togglePublic = async (col) => {
    const makingPublic = !col.is_public
    const shareCode = col.share_code || Math.random().toString(36).slice(2, 10)
    try {
      const { data, error } = await supabase
        .from('collections')
        .update({ is_public: makingPublic, share_code: shareCode })
        .eq('id', col.id)
        .select('*, collection_items(*)')
        .single()
      if (error) throw error
      setCollections(prev => prev.map(c => c.id === col.id ? data : c))
    } catch (e) { console.error('togglePublic error:', e) }
  }

  const addItemToCollection = async (col, anime) => {
    try {
      const { data, error } = await supabase
        .from('collection_items')
        .insert({
          collection_id: col.id,
          anilist_id: anime.id,
          title: anime.title?.english || anime.title?.romaji,
          image: anime.coverImage?.large || anime.coverImage?.extraLarge,
          color: anime.coverImage?.color,
          format: anime.format,
        })
        .select().single()
      if (error) throw error
      setCollections(prev => prev.map(c => c.id === col.id ? { ...c, collection_items: [...c.collection_items, data] } : c))
    } catch (e) {
      if (e.code === '23505') alert('Déjà dans cette collection.')
      else console.error('addItemToCollection error:', e)
    }
  }

  const removeItemFromCollection = async (col, item) => {
    try {
      await supabase.from('collection_items').delete().eq('id', item.id)
      setCollections(prev => prev.map(c => c.id === col.id ? { ...c, collection_items: c.collection_items.filter(i => i.id !== item.id) } : c))
    } catch (e) { console.error('removeItemFromCollection error:', e) }
  }

  return (
    <div className="scroll-area">
      <ScrollToTop />
      <div className="section-wrapper" style={{ paddingTop: '40px' }}>

        <div className="section-header">
          <div className="section-title">
            <i className="fas fa-layer-group"></i> Ma Collection
          </div>
        </div>

        {/* ─── Bascule Suivi / Collections perso ─── */}
        <div className="col-view-toggle">
          <button className={view === 'suivi' ? 'active' : ''} onClick={() => setView('suivi')}>
            <i className="fas fa-list-check"></i> Suivi <span>{watchlist.length}</span>
          </button>
          <button className={view === 'collections' ? 'active' : ''} onClick={() => setView('collections')}>
            <i className="fas fa-record-vinyl"></i> Mes Collections <span>{collections.length}</span>
          </button>
        </div>

        {/* ═══════════════ VUE SUIVI (comportement existant) ═══════════════ */}
        {view === 'suivi' && (
          <>
            <div className="tabs-row">
              {STATUS_TABS.map(t => (
                <button
                  key={t.value}
                  className={`tab-btn ${activeTab === t.value ? 'active' : ''}`}
                  onClick={() => setActiveTab(t.value)}
                >
                  {t.label}
                  <span className="tab-count">
                    {t.value === 'all' ? watchlist.length : watchlist.filter(w => w.status === t.value).length}
                  </span>
                </button>
              ))}
            </div>

            {filtered.length === 0 && (
              <div className="empty-state">
                <i className="fas fa-ghost"></i>
                <h3>C'est vide ici...</h3>
                <p>Ajoute des animés depuis l'accueil ou l'explorateur !</p>
              </div>
            )}

            {filtered.length > 0 && (
              <div className="grid-cards">
                {filtered.map(item => (
                  <div key={item.id} className="card" onClick={() => onOpenModal(item._anime || item)}>
                    <div className="card-img-container">
                      <img src={item.image} className="card-img" loading="lazy" alt={item.title} />
                      {item.userRating && <div className="user-rating-badge">★ {item.userRating}</div>}
                      <div className={`status-tag ${statusClass(item.status)}`}>{statusLabel(item.status)}</div>
                      {item.status === 'watching' && item.totalEpisodes > 0 && (
                        <div className="progress-bar-card">
                          <div className="progress-bar-fill" style={{ width: `${item.percentage || 0}%` }}></div>
                        </div>
                      )}
                    </div>
                    <div className="card-info">
                      <h3>{item.title}</h3>
                      <p>{item.status === 'watching' ? `Ép. ${item.progress || 0}/${item.totalEpisodes || '?'}` : item.format || ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ═══════════════ VUE COLLECTIONS PERSO ═══════════════ */}
        {view === 'collections' && !user && (
          <div className="empty-state">
            <i className="fas fa-lock"></i>
            <h3>Connecte-toi pour créer tes collections</h3>
            <p>Wishlist, coups de cœur, listes entre amis... crée tes propres playlists d'animés.</p>
            <button className="btn btn-primary" onClick={onAuthOpen} style={{ marginTop: '16px' }}>Se connecter</button>
          </div>
        )}

        {view === 'collections' && user && !openCollection && (
          <>
            {colLoading && (
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <i className="fas fa-spinner" style={{ fontSize: '2rem', color: '#ff5500', animation: 'spin 1s linear infinite' }}></i>
              </div>
            )}

            {!colLoading && (
              <div className="col-grid">
                <button className="col-card col-card--new" onClick={() => setCreateOpen(true)}>
                  <i className="fas fa-plus"></i>
                  <span>Créer une collection</span>
                </button>

                {collections.map(col => (
                  <div key={col.id} className="col-card" onClick={() => setOpenCollection(col)}>
                    <CollectionCover items={col.collection_items} icon={col.icon} color={col.color} />
                    <div className="col-card-info">
                      <h3>{col.title}</h3>
                      <p>{col.collection_items.length} titre{col.collection_items.length > 1 ? 's' : ''}{col.is_public && ' · publique'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!colLoading && (
              <div className="col-templates">
                <p className="explorer-label">Partir d'un modèle</p>
                <div className="col-templates-row">
                  {TEMPLATES.map(t => (
                    <button key={t.title} className="col-template-btn" style={{ '--tc': t.color }}
                      onClick={() => createCollection(t)}>
                      <div className="col-template-icon" style={{ background: `${t.color}22`, color: t.color }}>
                        <i className={`fas ${t.icon}`}></i>
                      </div>
                      <div className="col-template-text">
                        <span className="col-template-title">{t.title}</span>
                        <span className="col-template-desc">{t.description}</span>
                      </div>
                      <i className="fas fa-plus col-template-plus"></i>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ─── Détail d'une collection ─── */}
        {view === 'collections' && user && openCollection && (
          <CollectionDetail
            collection={openCollection}
            onBack={() => setOpenCollection(null)}
            onOpenModal={onOpenModal}
            onDelete={() => deleteCollection(openCollection)}
            onTogglePublic={() => togglePublic(openCollection)}
            onAddItem={(anime) => addItemToCollection(openCollection, anime)}
            onRemoveItem={(item) => removeItemFromCollection(openCollection, item)}
          />
        )}

        {createOpen && (
          <CreateCollectionModal onClose={() => setCreateOpen(false)} onCreate={createCollection} />
        )}
      </div>
    </div>
  )
}

/* ─── Modale de création ─────────────────────────────────────── */
function CreateCollectionModal({ onClose, onCreate }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState(ICON_PRESETS[0])
  const [color, setColor] = useState(COLOR_PRESETS[0])

  const submit = () => {
    if (!title.trim()) return
    onCreate({ title: title.trim(), description: description.trim() || null, icon, color, is_public: false })
  }

  return (
    <div className="col-modal-overlay" onClick={onClose}>
      <div className="col-modal" onClick={e => e.stopPropagation()}>
        <div className="col-modal-head">
          <h3><i className="fas fa-record-vinyl"></i> Nouvelle collection</h3>
          <button className="aw-close" onClick={onClose}><i className="fas fa-times"></i></button>
        </div>

        <div className="col-modal-preview" style={{ background: `linear-gradient(135deg, ${color}55, #0d0d0f)` }}>
          <i className={`fas ${icon}`} style={{ color }}></i>
        </div>

        <label className="form-label">Titre</label>
        <input className="form-input" placeholder="Ex : Mes coups de cœur" value={title} onChange={e => setTitle(e.target.value)} autoFocus />

        <label className="form-label">Description (optionnel)</label>
        <input className="form-input" placeholder="Une phrase pour te souvenir du thème" value={description} onChange={e => setDescription(e.target.value)} />

        <label className="form-label">Icône</label>
        <div className="col-picker-row">
          {ICON_PRESETS.map(i => (
            <button key={i} className={`col-icon-btn${icon === i ? ' active' : ''}`} style={icon === i ? { borderColor: color, color } : {}} onClick={() => setIcon(i)}>
              <i className={`fas ${i}`}></i>
            </button>
          ))}
        </div>

        <label className="form-label">Couleur</label>
        <div className="col-picker-row">
          {COLOR_PRESETS.map(c => (
            <button key={c} className={`col-color-btn${color === c ? ' active' : ''}`} style={{ background: c }} onClick={() => setColor(c)}></button>
          ))}
        </div>

        <button className="btn btn-primary" style={{ width: '100%', marginTop: '20px', justifyContent: 'center' }} disabled={!title.trim()} onClick={submit}>
          <i className="fas fa-check"></i> Créer la collection
        </button>
      </div>
    </div>
  )
}

/* ─── Vue détail d'une collection (contenu + ajout + partage) ─── */
function CollectionDetail({ collection, onBack, onOpenModal, onDelete, onTogglePublic, onAddItem, onRemoveItem }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const runSearch = async (q) => {
    if (q.trim().length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const { media } = await searchMedia({ search: q, type: 'ANIME', perPage: 8, isAdult: false, sort: ['SEARCH_MATCH'] })
      setResults(media)
    } catch (e) { console.error(e) }
    setSearching(false)
  }

  useEffect(() => {
    const t = setTimeout(() => runSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  const shareUrl = collection.share_code ? `${window.location.origin}${window.location.pathname}?c=${collection.share_code}` : null

  const copyLink = () => {
    if (!shareUrl) return
    navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const existingIds = new Set(collection.collection_items.map(i => i.anilist_id))

  return (
    <div className="col-detail">
      <button className="aw-back" onClick={onBack} style={{ marginBottom: '20px' }}>
        <i className="fas fa-chevron-left"></i> Mes collections
      </button>

      <div className="col-detail-head">
        <CollectionCover items={collection.collection_items} icon={collection.icon} color={collection.color} />
        <div className="col-detail-info">
          <h2>{collection.title}</h2>
          {collection.description && <p>{collection.description}</p>}
          <span className="col-detail-count">{collection.collection_items.length} titre{collection.collection_items.length > 1 ? 's' : ''}</span>

          <div className="col-detail-actions">
            <button className="btn btn-glass btn-sm" onClick={() => setAddOpen(o => !o)}>
              <i className="fas fa-plus"></i> Ajouter
            </button>
            <button className="btn btn-glass btn-sm" onClick={onTogglePublic}>
              <i className={`fas ${collection.is_public ? 'fa-lock-open' : 'fa-lock'}`}></i>
              {collection.is_public ? 'Publique' : 'Rendre publique'}
            </button>
            <button className="btn btn-danger btn-sm" onClick={onDelete}>
              <i className="fas fa-trash"></i>
            </button>
          </div>

          {collection.is_public && shareUrl && (
            <div className="col-share-box">
              <i className="fas fa-link"></i>
              <input readOnly value={shareUrl} onClick={e => e.target.select()} />
              <button onClick={copyLink}>{copied ? <i className="fas fa-check"></i> : 'Copier'}</button>
            </div>
          )}
        </div>
      </div>

      {addOpen && (
        <div className="col-add-box">
          <div className="search-box" style={{ width: '100%' }}>
            <i className="fas fa-search search-icon"></i>
            <input className="search-input" placeholder="Chercher un animé à ajouter..." value={search} onChange={e => setSearch(e.target.value)} autoFocus />
          </div>
          {searching && <p className="aw-panel-hint">Recherche...</p>}
          {!searching && results.length > 0 && (
            <div className="col-add-results">
              {results.map(a => {
                const already = existingIds.has(a.id)
                return (
                  <div key={a.id} className="col-add-result">
                    <img src={a.coverImage?.large} alt="" />
                    <span>{a.title?.english || a.title?.romaji}</span>
                    <button disabled={already} onClick={() => onAddItem(a)}>
                      {already ? <i className="fas fa-check"></i> : <i className="fas fa-plus"></i>}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {collection.collection_items.length === 0 ? (
        <div className="empty-state">
          <i className="fas fa-record-vinyl"></i>
          <h3>Collection vide</h3>
          <p>Utilise le bouton "Ajouter" pour commencer à la remplir.</p>
        </div>
      ) : (
        <div className="grid-cards">
          {collection.collection_items.map(item => (
            <div key={item.id} className="card col-item-card">
              <div className="card-img-container" onClick={() => onOpenModal({ id: item.anilist_id, title: { english: item.title }, coverImage: { large: item.image, color: item.color }, format: item.format })}>
                <img src={item.image} className="card-img" loading="lazy" alt={item.title} />
              </div>
              <div className="card-info">
                <h3>{item.title}</h3>
                <p>{item.format || ''}</p>
              </div>
              <button className="col-item-remove" onClick={() => onRemoveItem(item)}><i className="fas fa-times"></i></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Collection