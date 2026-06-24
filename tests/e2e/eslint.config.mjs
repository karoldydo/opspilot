import playwright from 'eslint-plugin-playwright';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    ...playwright.configs['flat/recommended'],
    files: ['**/*.ts'],
  },
  {
    files: ['**/*.ts'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
    },
  },
];
