import { defineConfig, UserConfig } from 'vite';
import path from 'path';

// Check what to build
const buildType = process.env.BUILD_TYPE || 'main'; // 'main', 'loader', 'extractor'

const configs: Record<string, UserConfig> = {
  main: {
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
  },
  loader: {
    root: '.',
    base: './',
    define: {
      'import.meta.url': '""',
      'import.meta': '{}'
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      emptyOutDir: false,
      rollupOptions: {
        input: {
          'content/loader': path.resolve(__dirname, 'src/content/loader.ts'),
        },
        output: {
          format: 'iife',
          entryFileNames: '[name].js',
        }
      }
    },
    publicDir: false
  },
  extractor: {
    root: '.',
    base: './',
    define: {
      'import.meta.url': '""',
      'import.meta': '{}'
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      emptyOutDir: false,
      rollupOptions: {
        input: {
          'content/extractor': path.resolve(__dirname, 'src/content/extractor.ts'),
        },
        output: {
          format: 'iife',
          entryFileNames: '[name].js',
        }
      }
    },
    publicDir: false
  }
};

export default defineConfig(configs[buildType] || configs.main);
