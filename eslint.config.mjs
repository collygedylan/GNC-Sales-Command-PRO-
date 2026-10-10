import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', '.gnc-local/**', '_site/**', 'artifacts/**', 'v2/dist/**',
    // Playwright records downloaded runtime copies; authored sources are linted separately.
    'test-results/**', 'playwright-report/**',
    'v2/storybook-static/**', 'assets/vendor/**', '**/*.min.js', '**/*.min.mjs', '**/*.database.types.ts',
    // This externally built partner app is checked in with a pinned provenance hash; lint its editable source when available, not this sealed minified output.
    'v2/public/partner/assets/index-B5eWPKuw.js',
    '**/database.types.ts', '**/*contracts.generated.ts', 'legacy_fallback/**', 'supabase/archive_migrations/**',
    'assets/alpha-command-center.js', 'assets/production-schedule.js', 'assets/assigned-items-table.js', 'assets/bunch-note-structured.js', 'assets/bunch-note-chunks/**', 'assets/field-counting.js', 'assets/field-counting-chunks/**'] },
  { files: ['**/*.{js,mjs,cjs,jsx}'], languageOptions: { ecmaVersion: 'latest',
    parserOptions: { ecmaFeatures: { jsx: true } },
    globals: { ...globals.browser, ...globals.node, ...globals.serviceworker } },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': 'off', 'no-empty': ['error', { allowEmptyCatch: true }],
      'no-regex-spaces': 'off', 'no-useless-escape': 'off' } },
  { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
    globals: { ...globals.browser, ...globals.node, ...globals.deno } },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { ...js.configs.recommended.rules, 'no-undef': 'off', 'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }], 'no-redeclare': 'off',
      'no-regex-spaces': 'off', 'no-useless-escape': 'off' } },
];
