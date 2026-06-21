import stylisticTs from '@stylistic/eslint-plugin';
import nx from '@nx/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';
import perfectionist from 'eslint-plugin-perfectionist';
import unusedImports from 'eslint-plugin-unused-imports';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
      '.claude/**',
      'context/**',
      'mockups/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          // allow the @app/* (web) and @api/* (api) self-aliases for intra-project imports
          // (role-bucketed layouts); the api <-> web <-> shared boundary is still policed via
          // depConstraints below.
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$', '^@api/', '^@app/'],
          depConstraints: [
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:api',
              onlyDependOnLibsWithTags: ['scope:api', 'scope:shared'],
            },
            {
              sourceTag: 'scope:web',
              onlyDependOnLibsWithTags: ['scope:web', 'scope:shared'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts', '**/*.js', '**/*.jsx', '**/*.cjs', '**/*.mjs'],
    // override or add rules here
    rules: {},
  },
  // stylistic format rules
  {
    files: ['**/*.ts'],
    plugins: { '@stylistic/ts': stylisticTs },
    rules: {
      '@stylistic/ts/lines-between-class-members': [
        'error',
        'always',
        { exceptAfterSingleLine: true, exceptAfterOverload: true },
      ],
    },
  },
  // perfectionist sorting rules
  {
    files: ['**/*.ts'],
    plugins: { perfectionist },
    rules: {
      'perfectionist/sort-array-includes': ['error'],
      'perfectionist/sort-enums': ['error'],
      'perfectionist/sort-exports': ['error'],
      'perfectionist/sort-heritage-clauses': [
        'error',
        {
          groups: [
            'onChanges',
            'onInit',
            'doCheck',
            'afterContentInit',
            'afterContentChecked',
            'afterViewInit',
            'afterViewChecked',
            'onDestroy',
            'unknown',
          ],
          customGroups: [
            { groupName: 'onChanges', elementNamePattern: '^OnChanges$' },
            { groupName: 'onInit', elementNamePattern: '^OnInit$' },
            { groupName: 'doCheck', elementNamePattern: '^DoCheck$' },
            { groupName: 'afterContentInit', elementNamePattern: '^AfterContentInit$' },
            { groupName: 'afterContentChecked', elementNamePattern: '^AfterContentChecked$' },
            { groupName: 'afterViewInit', elementNamePattern: '^AfterViewInit$' },
            { groupName: 'afterViewChecked', elementNamePattern: '^AfterViewChecked$' },
            { groupName: 'onDestroy', elementNamePattern: '^OnDestroy$' },
          ],
        },
      ],
      'perfectionist/sort-imports': ['error'],
      'perfectionist/sort-interfaces': ['error'],
      'perfectionist/sort-intersection-types': ['error'],
      'perfectionist/sort-modules': ['error'],
      'perfectionist/sort-named-exports': ['error'],
      'perfectionist/sort-named-imports': ['error'],
      'perfectionist/sort-object-types': ['error'],
      'perfectionist/sort-objects': ['error'],
      'perfectionist/sort-switch-case': ['error'],
      'perfectionist/sort-union-types': ['error'],
      'perfectionist/sort-variable-declarations': ['error'],
    },
  },
  // unused imports
  {
    files: ['**/*.ts'],
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      'unused-imports/no-unused-imports': 'error',
    },
  },
  // eslint rules
  {
    files: ['**/*.ts'],
    rules: {
      'no-duplicate-imports': 'error',
    },
  },
  eslintConfigPrettier,
];
