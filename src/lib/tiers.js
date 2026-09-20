/* ─── Paliers de membre ──────────────────────────────────────────────
   La même table était recopiée dans Profile.jsx, Topbar.jsx et Home.jsx,
   avec des champs qui avaient déjà commencé à diverger (seule la copie de
   Profile portait `rgb`). Une seule source ici, avec tous les champs. */

export const TIERS = [
  { min: 0, label: "Nouveau Watcher", color: "#71717a", rgb: "113,113,122" },
  { min: 10, label: "Initié Otaku", color: "#60a5fa", rgb: "96,165,250" },
  { min: 30, label: "Watcher Confirmé", color: "#34d399", rgb: "52,211,153" },
  { min: 60, label: "Watcher Légendaire", color: "#ff5500", rgb: "255,85,0" },
  { min: 100, label: "Maître des Animés", color: "#fbbf24", rgb: "251,191,36" },
  { min: 200, label: "Otaku Transcendant", color: "#c084fc", rgb: "192,132,252" },
];

export const getTier = (n) => {
  let tier = TIERS[0];
  for (const t of TIERS) if (n >= t.min) tier = t;
  return tier;
};
