import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function PublicCollection({ code, onExit }) {
  const [collection, setCollection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [user, setUser] = useState(null)
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [duplicating, setDuplicating] = useState(false)
  const [duplicated, setDuplicated] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase
          .from('collections')
          .select('*, collection_items(*)')
          .eq('share_code', code)
          .eq('is_public', true)
          .single()
        if (error || !data) { setNotFound(true) } else { setCollection(data) }
      } catch (e) {
        console.error('PublicCollection load error:', e)
        setNotFound(true)
      }
      setLoading(false)
    }
    load()
  }, [code])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data?.user || null))
  }, [])

  useEffect(() => {
    if (!collection) return
    supabase
      .from('collection_likes')
      .select('user_id')
      .eq('collection_id', collection.id)
      .then(({ data }) => {
        setLikeCount((data || []).length)
        setLiked(!!user && (data || []).some((r) => r.user_id === user.id))
      })
  }, [collection, user])

  const toggleLike = async () => {
    if (!user) return onExit()
    const next = !liked
    setLiked(next)
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)))
    try {
      if (next) {
        await supabase.from('collection_likes').insert({ collection_id: collection.id, user_id: user.id })
      } else {
        await supabase.from('collection_likes').delete().eq('collection_id', collection.id).eq('user_id', user.id)
      }
    } catch (e) {
      console.error('toggleLike error:', e)
    }
  }

  const duplicate = async () => {
    if (!user) return onExit()
    setDuplicating(true)
    try {
      const { data: newCol, error } = await supabase
        .from('collections')
        .insert({
          user_id: user.id,
          title: `${collection.title} (copie)`,
          description: collection.description || null,
          icon: collection.icon,
          color: collection.color,
          is_public: false,
        })
        .select()
        .single()
      if (error) throw error
      const items = (collection.collection_items || []).map((it) => ({
        collection_id: newCol.id,
        anilist_id: it.anilist_id,
        title: it.title,
        image: it.image,
        color: it.color,
        format: it.format,
      }))
      if (items.length > 0) await supabase.from('collection_items').insert(items)
      setDuplicated(true)
    } catch (e) {
      console.error('duplicate collection error:', e)
    }
    setDuplicating(false)
  }

  if (loading) {
    return (
      <div className="pc-wrap">
        <i className="fas fa-spinner" style={{ fontSize: '2rem', color: '#ff5500', animation: 'spin 1s linear infinite' }}></i>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="pc-wrap">
        <div className="empty-state">
          <i className="fas fa-ghost"></i>
          <h3>Collection introuvable</h3>
          <p>Ce lien n'existe plus ou a été rendu privé.</p>
          <button className="btn btn-primary" onClick={onExit} style={{ marginTop: '16px' }}>
            <i className="fas fa-meteor"></i> Découvrir Oplix
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pc-page">
      <div className="pc-header">
        <div className="brand"><i className="fas fa-meteor"></i> <span>OPLIX</span></div>
        <button className="btn btn-primary btn-sm" onClick={onExit}>Découvrir Oplix</button>
      </div>

      <div className="pc-hero" style={{ background: `linear-gradient(160deg, ${collection.color}33, #0d0d0f 70%)` }}>
        <div className="pc-cover">
          {collection.collection_items.slice(0, 4).map((it, i) => (
            <img key={i} src={it.image} alt="" />
          ))}
          {collection.collection_items.length === 0 && <i className={`fas ${collection.icon}`} style={{ color: collection.color, fontSize: '3rem' }}></i>}
        </div>
        <div className="pc-hero-info">
          <span className="pc-hero-label">Collection partagée</span>
          <h1>{collection.title}</h1>
          {collection.description && <p>{collection.description}</p>}
          <span>{collection.collection_items.length} titre{collection.collection_items.length > 1 ? 's' : ''}</span>
        </div>
      </div>

      <div className="section-wrapper" style={{ paddingBottom: 0 }}>
        <div className="col-detail-actions">
          <button className={`btn btn-glass btn-sm ${liked ? 'col-like--active' : ''}`} onClick={toggleLike}>
            <i className={`${liked ? 'fas' : 'far'} fa-heart`}></i> {likeCount > 0 ? likeCount : "J'aime"}
          </button>
          <button className="btn btn-glass btn-sm" onClick={duplicate} disabled={duplicating || duplicated}>
            <i className="fas fa-clone"></i> {duplicated ? 'Dupliquée' : duplicating ? 'Copie...' : 'Dupliquer'}
          </button>
        </div>
      </div>

      <div className="section-wrapper">
        {collection.collection_items.length === 0 ? (
          <div className="empty-state">
            <i className="fas fa-record-vinyl"></i>
            <h3>Cette collection est encore vide</h3>
          </div>
        ) : (
          <div className="grid-cards">
            {collection.collection_items.map(item => (
              <div key={item.id} className="card">
                <div className="card-img-container">
                  <img src={item.image} className="card-img" loading="lazy" alt={item.title} />
                </div>
                <div className="card-info">
                  <h3>{item.title}</h3>
                  <p>{item.format || ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pc-footer-cta">
          <p>Envie de créer et partager tes propres collections d'animés et mangas ?</p>
          <button className="btn btn-primary" onClick={onExit}>
            <i className="fas fa-meteor"></i> Rejoindre Oplix
          </button>
        </div>
      </div>
    </div>
  )
}

export default PublicCollection