// ESLint setup. Next 16 removed `next lint`, so linting runs through the ESLint CLI (`npm run lint` from the app root).
// It lives in tools/lint with its own node_modules: see the description in tools/lint/package.json.
import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The React Compiler rules arrived with eslint-plugin-react-hooks 7, after this code was written.
    // The existing map components trip them (15 places, 2026-11-23). They are warnings here so `npm run lint`
    // can gate new problems; raise them back to "error" once those places are refactored.
    rules: {
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Generated or local-only data:
    'data/**',
    '.data/**',
  ]),
])

export default eslintConfig
