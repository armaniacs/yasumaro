import { defineConfig } from 'wxt';

/**
 * WXT Configuration for Obsidian Weave
 */
export default defineConfig({
  // Output directory
  outDir: 'dist',
  
  // Browser type  
  browser: 'chromium',
  
  // Public assets that should be copied
  publicDir: [
    'src/popup/i18n.js',
    'icons',
  ],
  
  // Manifest configuration
  manifest: {
    manifest_version: 3,
    name: '__MSG_extensionName__',
    short_name: '__MSG_extensionShortName__',
    version: '5.1.4',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    icons: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
    permissions: [
      'tabs',
      'storage',
      'scripting', 
      'notifications',
      'offscreen',
      'favicon',
      'unlimitedStorage',
      'webRequest',
      'alarms',
    ],
    optional_host_permissions: ['<all_urls>'],
    host_permissions: ['<all_urls>'],
  },
});