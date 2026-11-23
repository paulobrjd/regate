import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 800 },
  // en développement, le jeu en ligne passe par le serveur local (npm run serveur)
  server: { proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } } },
});
