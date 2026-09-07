import { useState } from 'react'
import { supabase } from '../lib/supabase'

function Auth({ onClose }) {
  const [tab, setTab] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async () => {
    setError('')
    setSuccess('')
    if (!email || !password) { setError('Email et mot de passe requis.'); return }
    if (password.length < 6) { setError('Le mot de passe doit faire au moins 6 caractères.'); return }
    setLoading(true)
    try {
      if (tab === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        onClose()
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username: username || email.split('@')[0] } }
        })
        if (error) throw error
        setSuccess('Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse.')
      }
    } catch (e) {
      const messages = {
        'Invalid login credentials': 'Email ou mot de passe incorrect.',
        'Email not confirmed': 'Confirme ton email avant de te connecter.',
        'User already registered': 'Un compte existe déjà avec cet email.',
        'Password should be at least 6 characters': 'Le mot de passe doit faire au moins 6 caractères.',
      }
      setError(messages[e.message] || e.message)
    }
    setLoading(false)
  }

  return (
    <div className="auth-overlay" onMouseDown={e => {
        if (e.target === e.currentTarget && window.getSelection().toString() === '') onClose()
        }}>
        <div className="auth-box" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="auth-header">
          <div className="auth-brand">
            <i className="fas fa-meteor"></i> OPLIX
          </div>
          <button className="close-btn" onClick={onClose}>
            <i className="fas fa-times"></i>
          </button>
        </div>

        <p className="auth-subtitle">
          {tab === 'login' ? 'Bon retour parmi nous.' : 'Rejoins la communauté Oplix.'}
        </p>

        {/* Tabs */}
        <div className="auth-tabs">
          <button
            className={`auth-tab-btn ${tab === 'login' ? 'active' : ''}`}
            onClick={() => { setTab('login'); setError(''); setSuccess('') }}
          >
            Connexion
          </button>
          <button
            className={`auth-tab-btn ${tab === 'signup' ? 'active' : ''}`}
            onClick={() => { setTab('signup'); setError(''); setSuccess('') }}
          >
            Inscription
          </button>
        </div>

        {/* Messages */}
        {error && (
          <div className="auth-error">
            <i className="fas fa-circle-xmark"></i> {error}
          </div>
        )}
        {success && (
          <div className="auth-success">
            <i className="fas fa-circle-check"></i> {success}
          </div>
        )}

        {/* Formulaire */}
        {!success && (
          <>
            {tab === 'signup' && (
              <div className="form-group">
                <label className="form-label">Pseudo</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="SachaOtaku"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                placeholder="toi@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Mot de passe</label>
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>

            <button
              className="auth-submit"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading
                ? <><i className="fas fa-spinner" style={{ animation: 'spin 1s linear infinite' }}></i> Chargement...</>
                : tab === 'login' ? 'Se connecter' : 'Créer mon compte'
              }
            </button>
          </>
        )}

        {success && (
          <button className="auth-submit" onClick={onClose}>
            Fermer
          </button>
        )}

      </div>
    </div>
  )
}

export default Auth