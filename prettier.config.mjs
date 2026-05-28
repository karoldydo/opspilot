export default {
  attributeGroups: [
    // plugins configuration
    '$CODE_GUIDE',
    '$ANGULAR_ELEMENT_REF',
    '$ANGULAR_STRUCTURAL_DIRECTIVE',
    '$ANGULAR_ANIMATION',
    '$ANGULAR_ANIMATION_INPUT',
    '$ANGULAR_TWO_WAY_BINDING',
    '$ANGULAR_INPUT',
    '$ANGULAR_OUTPUT',
  ],
  attributeSort: 'ASC',
  jsonRecursiveSort: true,
  plugins: [
    'prettier-plugin-organize-attributes',
    'prettier-plugin-packagejson',
    'prettier-plugin-sort-json',
    'prettier-plugin-tailwindcss',
  ],
  // default prettier options
  printWidth: 120,
  singleQuote: true,
  trailingComma: 'es5',
};
