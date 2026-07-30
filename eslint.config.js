import importPlugin from 'eslint-plugin-import'
import tsParser from '@typescript-eslint/parser'

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    // Pre-existing `// eslint-disable-line react-hooks/exhaustive-deps` comments
    // (App.jsx, PlaidLinkButton.jsx) predate this config and reference a plugin
    // this task doesn't install. A stub rule definition (no logic, never enabled
    // below) is enough to make ESLint recognize the rule ID so those comments
    // don't error as "Definition for rule not found" — out of scope to actually
    // enforce react-hooks rules here.
    plugins: {
      'react-hooks': { rules: { 'exhaustive-deps': { create: () => ({}) } } },
    },
  },

  // Rule 1: no raw Supabase client creation — only the shared singleton may do it.
  // (glob split across two entries, not '*.{js,jsx}' — brace syntax crashes this
  // repo's pinned minimatch@3.1.5 + brace-expansion@5.x combo, see chat for why)
  {
    files: ['src/**/*.js', 'src/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@supabase/supabase-js',
          message: 'Import the shared client from src/utils/supabase.js instead of creating a new one.',
        }],
      }],
    },
  },
  {
    // The one allowed place to import @supabase/supabase-js directly.
    files: ['src/utils/supabase.js'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // Rule 3: lib/ utilities must not depend on screen components.
  {
    files: ['src/lib/**/*.js', 'src/lib/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { import: importPlugin },
    // eslint-import-resolver-node only resolves .js/.json/.node by default —
    // without this, imports of .jsx files silently fail to resolve and the
    // rule below skips them without reporting anything (verified: this is
    // exactly what made rule 4 falsely show 0 violations before this line).
    settings: { 'import/resolver': { node: { extensions: ['.js', '.jsx'] } } },
    rules: {
      'import/no-restricted-paths': ['error', {
        zones: [
          { target: './src/lib', from: './src/components' },
        ],
      }],
    },
  },

  // Rule 2: edge functions' shared code must not import client-side src/.
  {
    files: ['supabase/functions/_shared/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: { import: importPlugin },
    settings: { 'import/resolver': { node: { extensions: ['.js', '.jsx', '.ts'] } } },
    rules: {
      'import/no-restricted-paths': ['error', {
        zones: [
          { target: './supabase/functions/_shared', from: './src' },
        ],
      }],
    },
  },

  // Rule 4 (warn, not error): routed screens shouldn't import from each other.
  // 3 known exceptions today (InsightCard, fmtMoney) — CLAUDE.md says keep
  // components in the file where they're used unless asked to extract, so this
  // stays advisory rather than blocking until that's revisited on purpose.
  {
    files: ['src/components/*.js', 'src/components/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { import: importPlugin },
    settings: { 'import/resolver': { node: { extensions: ['.js', '.jsx'] } } },
    rules: {
      'import/no-restricted-paths': ['warn', {
        zones: [
          {
            target: [
              './src/components/Dashboard.jsx',
              './src/components/Transactions.jsx',
              './src/components/Savings.jsx',
              './src/components/Insights.jsx',
              './src/components/Markets.jsx',
              './src/components/Profile.jsx',
            ],
            from: [
              './src/components/Dashboard.jsx',
              './src/components/Transactions.jsx',
              './src/components/Savings.jsx',
              './src/components/Insights.jsx',
              './src/components/Markets.jsx',
              './src/components/Profile.jsx',
            ],
          },
        ],
      }],
    },
  },
]
