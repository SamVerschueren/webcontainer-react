import * as esbuild from 'esbuild';

const external = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@webcontainer/api',
  '@codemirror/view',
  '@codemirror/state',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/lang-javascript',
  '@codemirror/lang-css',
  '@lezer/highlight',
];

const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  external,
  sourcemap: true,
  target: 'es2020',
  jsx: 'automatic',
};

await Promise.all([
  esbuild.build({...shared, format: 'esm', outfile: 'dist/index.js'}),
  esbuild.build({...shared, format: 'cjs', outfile: 'dist/index.cjs'}),
]);
