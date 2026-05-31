const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/api'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      // explicit object form so migrations land deterministically at
      // dist/apps/api/migrations (the bundle-relative path the runner resolves).
      // the leading './' resolves input against the project root, not the
      // workspace root — without it nx looks for <workspaceRoot>/migrations.
      assets: ['./src/assets', { input: './migrations', output: 'migrations', glob: '**/*' }],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
  ],
};
