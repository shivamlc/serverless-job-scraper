// @ts-check
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

/**
 * Enforces spec 01 / spec 11's rule: src/adapters/** and src/handlers/** must never
 * read `process.env` directly, no exceptions. Anything those layers need from the
 * environment goes through a src/lib/ getter instead (getSkipWindowHours(),
 * getJobScrapeQueueUrl(), etc.).
 */
const noProcessEnv = {
  selector:
    "MemberExpression[object.name='process'][property.name='env']",
  message:
    'src/adapters/** and src/handlers/** must not read process.env directly — add/use a getter under src/lib/ instead (see specs/01-search-params-and-config.md).',
};

export default [
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/adapters/**/*.ts', 'src/handlers/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', noProcessEnv],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
];
