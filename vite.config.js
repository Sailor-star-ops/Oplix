import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Tout partait dans un seul fichier de ~500 Ko : le navigateur le
        // retelechargeait entierement a chaque mise en ligne, meme quand seul
        // le code de l'app avait bouge. React et le client Supabase changent
        // rarement, on les isole pour qu'ils restent en cache.
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
})
