import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'src/components/MasterDataDuplicateReviewPanel.tsx', 'src/pages/MasterDataHub.tsx'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^selectedLoad$' }],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  { files: ['src/pages/RunsCapacityAllocation.tsx'], rules: { 'no-useless-escape': 'off' } },
  {
    // JobsOperational intentionally exports two pure market/destination helpers that are
    // covered independently and reused outside the component. They are not React components.
    files: ['src/pages/JobsOperational.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
);