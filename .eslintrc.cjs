module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.2' } },
  plugins: ['react-refresh'],
  // Les scripts d'import tournent sous Node (process, console), pas dans le
  // navigateur : sans cet override, chaque `process.env` remonte en no-undef.
  overrides: [
    {
      files: ['scripts/**/*.mjs'],
      env: { node: true, browser: false },
    },
  ],
  rules: {
    // 650 des 697 erreurs de lint venaient de cette seule regle, sur un projet
    // qui n'utilise nulle part les PropTypes (pas de TypeScript non plus) :
    // elle noyait les vraies erreurs au lieu de les signaler.
    'react/prop-types': 'off',
    // Interface entierement en francais : cette regle signale chaque
    // apostrophe d'un texte JSX, ce qui est parfaitement valide en React.
    'react/no-unescaped-entities': 'off',
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
  },
}
