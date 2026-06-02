import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// react-hooks v7 bundles React Compiler lint rules in its recommended config.
// We don't use the React Compiler, so disable those rules explicitly.
// The two canonical hook rules (rules-of-hooks, exhaustive-deps) remain on.
const REACT_COMPILER_RULES_OFF = {
  'react-hooks/set-state-in-effect': 'off',
  'react-hooks/set-state-in-render': 'off',
  'react-hooks/static-components': 'off',
  'react-hooks/use-memo': 'off',
  'react-hooks/preserve-manual-memoization': 'off',
  'react-hooks/incompatible-library': 'off',
  'react-hooks/immutability': 'off',
  'react-hooks/globals': 'off',
  'react-hooks/refs': 'off',
  'react-hooks/error-boundaries': 'off',
  'react-hooks/purity': 'off',
  'react-hooks/unsupported-syntax': 'off',
  'react-hooks/config': 'off',
  'react-hooks/gating': 'off',
};

export default defineConfig([
  globalIgnores([
    'dist',
    '.claude',
    '.gitnexus',
    'memory',
    'node_modules',
    'wasm/.toolchain',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      ...REACT_COMPILER_RULES_OFF,
    },
  },
])
