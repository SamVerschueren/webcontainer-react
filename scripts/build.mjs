import * as esbuild from 'esbuild';
import fs from 'node:fs';

// Pre-bundle error-stack-parser-es/lite into a self-contained ESM string
// so the Vite plugin can serve it as a virtual module at runtime.
const parserBuild = await esbuild.build({
  stdin: {
    contents: `export { parseStack } from 'error-stack-parser-es/lite'`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: 'esm',
  write: false,
});

// Pre-bundle the error-reporter client code so it can be served
// as a virtual module by the Vite plugin at runtime.
const clientBuild = await esbuild.build({
  entryPoints: ['plugins/error-reporter-client.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  write: false,
  external: ['virtual:error-stack-parser'],
});

// Build the error-reporter Vite plugin as a self-contained ESM bundle
// with @jridgewell/trace-mapping bundled in (no externals).
const pluginBuild = await esbuild.build({
  entryPoints: ['plugins/error-reporter.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  write: false,
  define: {
    __ERROR_STACK_PARSER_SOURCE__: JSON.stringify(parserBuild.outputFiles[0].text),
    __CLIENT_CODE__: JSON.stringify(clientBuild.outputFiles[0].text),
  },
});
const pluginCode = pluginBuild.outputFiles[0].text;

fs.mkdirSync('dist/plugins', {recursive: true});
fs.writeFileSync('dist/plugins/error-reporter.js', pluginCode);

// esbuild plugin that resolves `virtual:error-reporter-source` to the
// bundled plugin source so it can be inlined into the main library.
const inlinePluginSource = {
  name: 'inline-plugin-source',
  setup(build) {
    build.onResolve({filter: /^virtual:error-reporter-source$/}, () => ({
      path: 'error-reporter-source',
      namespace: 'inline',
    }));
    build.onLoad({filter: /.*/, namespace: 'inline'}, () => ({
      contents: `export default ${JSON.stringify(pluginCode)};`,
      loader: 'js',
    }));
  },
};

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
  plugins: [inlinePluginSource],
};

await Promise.all([
  esbuild.build({...shared, format: 'esm', outfile: 'dist/index.js'}),
  esbuild.build({...shared, format: 'cjs', outfile: 'dist/index.cjs'}),
]);
