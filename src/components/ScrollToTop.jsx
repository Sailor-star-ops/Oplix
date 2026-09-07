import { useEffect, useRef, useState } from "react";

const RADIUS = 19;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SHOW_AFTER_PX = 280;

/* Bouton "remonter en haut" : se pose n'importe où dans un ".scroll-area"
   (il retrouve son conteneur scrollable via closest, indépendamment de son
   position:fixed) et affiche un anneau qui se remplit selon la progression
   du scroll dans la page — pas de bibliothèque, juste un cercle SVG animé
   en stroke-dashoffset. */
function ScrollToTop() {
  const anchorRef = useRef(null);
  const scrollElRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const scrollEl = anchorRef.current?.closest(".scroll-area");
    if (!scrollEl) return;
    scrollElRef.current = scrollEl;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      const max = scrollHeight - clientHeight;
      setProgress(max > 0 ? Math.min(1, scrollTop / max) : 0);
      setVisible(scrollTop > SHOW_AFTER_PX);
    };

    onScroll();
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, []);

  const handleClick = () => {
    scrollElRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div ref={anchorRef} className={`scroll-top ${visible ? "scroll-top--visible" : ""}`}>
      <button
        type="button"
        className="scroll-top__btn"
        onClick={handleClick}
        aria-label="Remonter en haut de la page"
        tabIndex={visible ? 0 : -1}
      >
        <svg className="scroll-top__ring" viewBox="0 0 44 44">
          <circle className="scroll-top__ring-track" cx="22" cy="22" r={RADIUS} />
          <circle
            className="scroll-top__ring-fill"
            cx="22"
            cy="22"
            r={RADIUS}
            style={{
              strokeDasharray: CIRCUMFERENCE,
              strokeDashoffset: CIRCUMFERENCE * (1 - progress),
            }}
          />
        </svg>
        <i className="fas fa-chevron-up"></i>
      </button>
    </div>
  );
}

export default ScrollToTop;
