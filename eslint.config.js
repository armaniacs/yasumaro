import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import localPlugin from './eslint/plugin.mjs';

export default [
  {
    ignores: ['node_modules/', 'dist/', 'testDir/', 'coverage/', 'src/**/__tests__/**'],
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/utils/logger.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: process.cwd(),
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      local: localPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'local/require-sanitized-markdown': 'error',
      'local/require-response-size-limit': 'error',
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['**/logger/types.js', '**/logger/core.js', '**/logger/api.js'],
              message: 'logger/* is an internal implementation detail. Import from logger.js instead.',
            },
            {
              group: ['**/settingsStore', '**/settingsStore.js'],
              message: 'Use SettingsRepository instead (PBI-04). Import from ./storage/SettingsRepository.js or ./storage/settingsMigration.js / ./storage/urlWhitelist.js',
            },
          ],
          paths: [
            {
              name: '../../utils/storage.js',
              message: 'Use direct module imports instead (e.g., from ./storage/types.js or ./storage/settingsStore.js). See dev-docs/LAYERS.md Wave 3.',
            },
            {
              name: '../utils/storage.js',
              message: 'Use direct module imports instead (e.g., from ../utils/storage/types.js). See dev-docs/LAYERS.md Wave 3.',
            },
            {
              name: './storage.js',
              message: 'Use direct module imports instead. See dev-docs/LAYERS.md Wave 3.',
            },
            {
              name: 'src/utils/storage.js',
              message: 'Use direct module imports instead. See dev-docs/LAYERS.md Wave 3.',
            },
            {
              name: './settingsStore',
              message: 'Use SettingsRepository instead (PBI-04). See src/utils/storage/SettingsRepository.ts',
            },
            {
              name: './settingsStore.js',
              message: 'Use SettingsRepository instead (PBI-04). See src/utils/storage/SettingsRepository.ts',
            },
            {
              name: '../utils/storage/settingsStore',
              message: 'Use SettingsRepository instead (PBI-04). See src/utils/storage/SettingsRepository.ts',
            },
            {
              name: '../utils/storage/settingsStore.js',
              message: 'Use SettingsRepository instead (PBI-04). See src/utils/storage/SettingsRepository.ts',
            },
            {
              name: '../../utils/storage/settingsStore',
              message: 'Use SettingsRepository instead (PBI-04). See src/utils/storage/SettingsRepository.ts',
            },
            {
              name: '../../utils/storage/settingsStore.js',
              message: 'Use SettingsRepository instead (PBI-04). See src/utils/storage/SettingsRepository.ts',
            },
            {
              name: '../../../utils/storage/settingsStore',
              message: 'Use SettingsRepository instead (PBI-04). See src/utils/storage/SettingsRepository.ts',
            },
            {
              name: '../../../utils/storage/settingsStore.js',
              message: 'Use SettingsRepository instead (PBI-04). See src/utils/storage/SettingsRepository.ts',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/utils/logger.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: process.cwd(),
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      local: localPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'local/require-sanitized-markdown': 'error',
      'local/require-response-size-limit': 'error',
    },
  },
  {
    files: ['**/*.ts'],
    ignores: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
];
