import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared flat ESLint config for the whole workspace.
 *
 * Each package runs `eslint .` from its own directory; ESLint walks up to this
 * file, so lint rules are defined once and can never drift between packages.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/migrations/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },

  // The db package's command-line entrypoints. `no-console` exists to keep
  // stray debug output out of request handlers; for a script a human runs from
  // a terminal, stdout is the entire user interface.
  {
    files: ['db/src/migrate.ts', 'db/src/seed.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // The frontend runs in the browser, not Node.
  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // React rules for the client.
  //
  // Accessibility is a must-check on every frontend PR (REVIEWER.md §6), which
  // is only enforceable if a linter checks it — so jsx-a11y lands here with the
  // very first component rather than after a pile of markup has accumulated.
  // react-hooks catches the rules-of-hooks violations TypeScript cannot see.
  //
  // Covers .ts as well as .tsx on purpose: custom hooks live in plain .ts under
  // features/ (PROJECT_STRUCTURE.md §3), and that is exactly where a
  // conditionally-called hook hides. jsx-a11y is inert on files without JSX, so
  // widening the glob costs nothing.
  {
    files: ['frontend/**/*.{ts,tsx}'],
    plugins: {
      'jsx-a11y': jsxA11y,
      'react-hooks': reactHooks,
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      ...reactHooks.configs['recommended-latest'].rules,
    },
  },

  // Must stay last: switches off every rule that would fight Prettier.
  prettier,
);
