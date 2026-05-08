module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    // Allow unused vars prefixed with underscore
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // Enforce no empty catch blocks (per ADR 007)
    'no-empty': ['error', { allowEmptyCatch: false }],
  },
  ignorePatterns: ['node_modules/', 'dist/', '*.js', '*.cjs'],
};
