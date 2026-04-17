import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/popup/popup.html'),
        'background/service-worker': path.resolve(__dirname, 'src/background/service-worker.ts'),
        'content/loader': path.resolve(__dirname, 'src/content/loader.ts'),
        'content/extractor': path.resolve(__dirname, 'src/content/extractor.ts'),
        dashboard: path.resolve(__dirname, 'src/dashboard/dashboard.html'),
        privacy: path.resolve(__dirname, 'src/privacy/privacy.html'),
        'dashboard/models-dev-dialog': path.resolve(__dirname, 'src/dashboard/models-dev-dialog.html'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  publicDir: 'public'
});
