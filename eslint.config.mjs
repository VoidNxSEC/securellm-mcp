import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Base recommended rules
  eslint.configs.recommended,
  tseslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  // TypeScript-specific config
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Ignore build artifacts and JS files (already compiled)
  {
    ignores: ['build/**', 'node_modules/**', '**/*.js', '**/*.mjs'],
  },
);
