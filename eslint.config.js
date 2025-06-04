const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettierPlugin = require('eslint-plugin-prettier');
const importPlugin = require('eslint-plugin-import');

module.exports = [
  {
    ignores: [
      'node_modules',
      'dist',
      'package.json',
      'package-lock.json',
      'yarn.lock',
      'tsconfig.json',
      '.prettierrc',
      '.cursor',
      'README.md',
    ],
    files: ['src/**/*.{js,ts}'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      parser: tsParser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
      import: importPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'prettier/prettier': 'error',
      'import/extensions': [
        'error',
        'ignorePackages',
        {
          ts: 'never',
          js: 'never',
        },
      ],
      'import/no-unresolved': 'off',
      'import/prefer-default-export': 'off',
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },
];
