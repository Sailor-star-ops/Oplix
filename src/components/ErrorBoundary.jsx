import { Component } from "react";

/* ─── Garde-fou ──────────────────────────────────────────────────────
   Sans ce composant, une seule erreur dans une page démonte tout l'arbre
   React et l'utilisateur se retrouve devant une page blanche, sans rien
   comprendre ni pouvoir revenir en arrière. C'est arrivé en vrai pendant
   le développement du 2026-09-20.

   Un ErrorBoundary doit être une classe : React n'expose pas
   componentDidCatch aux composants à fonction. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Pas de service de suivi d'erreurs pour l'instant : au moins la console
    // du navigateur garde la pile complète.
    console.error("Erreur non rattrapée :", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="errb">
        <i className="fa-solid fa-triangle-exclamation errb__icon" />
        <h2 className="errb__title">Quelque chose s&apos;est cassé de notre côté</h2>
        <p className="errb__text">
          Cette page n&apos;a pas pu s&apos;afficher. Tes listes et ton compte n&apos;ont rien perdu.
        </p>
        <div className="errb__actions">
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Réessayer
          </button>
          <button className="btn btn-secondary" onClick={() => window.location.reload()}>
            Recharger la page
          </button>
        </div>
        <details className="errb__details">
          <summary>Détail technique</summary>
          <code>{String(this.state.error?.message || this.state.error)}</code>
        </details>
      </div>
    );
  }
}
