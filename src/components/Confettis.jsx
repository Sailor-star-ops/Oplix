import { useEffect, useRef } from "react";

/* ─── Confettis de victoire ──────────────────────────────────────────
   Écrit à la main plutôt qu'importé : une bibliothèque de confettis pèse
   plus lourd que ces quarante lignes, et on veut les couleurs de la
   maison, pas celles d'un paquet npm.

   Le canvas est posé au-dessus de tout, sans capter les clics, et se
   démonte tout seul quand les particules sont tombées. */

const COULEURS = ["#ff5500", "#ff8c42", "#ffd166", "#ffffff", "#c084fc"];
const NOMBRE = 90;

export default function Confettis() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const l = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    canvas.width = l * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Deux gerbes latérales plutôt qu'une pluie : le mouvement part du bas,
    // comme un tir de canon, ce qui se lit mieux qu'une chute molle.
    const particules = Array.from({ length: NOMBRE }, (_, i) => {
      const gauche = i % 2 === 0;
      const angle = (gauche ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.7;
      const force = 9 + Math.random() * 7;
      return {
        x: gauche ? l * 0.12 : l * 0.88,
        y: h * 0.75,
        vx: Math.cos(angle) * force * (gauche ? 1 : -1),
        vy: Math.sin(angle) * force,
        taille: 5 + Math.random() * 6,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.3,
        couleur: COULEURS[Math.floor(Math.random() * COULEURS.length)],
        vie: 1,
      };
    });

    let raf;
    const dessiner = () => {
      ctx.clearRect(0, 0, l, h);
      let vivantes = 0;
      for (const p of particules) {
        p.vy += 0.34; // gravité
        p.vx *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        if (p.y > h * 0.62) p.vie -= 0.015;
        if (p.vie <= 0) continue;
        vivantes++;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.vie);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.couleur;
        ctx.fillRect(-p.taille / 2, -p.taille / 4, p.taille, p.taille / 2);
        ctx.restore();
      }
      if (vivantes > 0) raf = requestAnimationFrame(dessiner);
    };
    raf = requestAnimationFrame(dessiner);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas className="confettis" ref={ref} aria-hidden="true" />;
}
