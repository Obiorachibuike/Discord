import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      'packages/web/next-env.d.ts',
      'packages/database/src/generated/**',
      '.pg-data/**',
      '.pgdata/**',
      'uploads/**',
      '.smoke-uploads/**',
      // Parallel "Cove" implementation (kept on main from PR #1) — untouched.
      'apps/**',
      'tests/**',
      'packages/db/**',
      'scripts/cleanup-orphans.ts',
      'vitest.config.mts',
      '.eslintrc.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
