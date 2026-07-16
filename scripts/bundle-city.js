// Bundle the 3D city viewer into self-contained HTML via esbuild.
//
// Unlike the 2D map (dependency-free, bundled by hand in bundle-web.js), the city
// viewer imports three.js, so it needs a real bundler. esbuild inlines three +
// the tested src/ modules into one IIFE, which is embedded in:
//
//   dist/city.html      standalone doc — open in a browser or serve anywhere
//   dist/city.art.html  fragment for the Claude Artifact wrapper
//
// Outputs are self-contained (three is inlined) so they work under the Artifact
// CSP with no external requests.

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const result = await esbuild.build({
  entryPoints: [join(root, 'web', 'city.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  write: false,
});
const js = result.outputFiles[0].text;

const html = readFileSync(join(root, 'web', 'city.html'), 'utf8');
const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
const bodyInner = html
  .match(/<body>([\s\S]*?)<\/body>/)[1]
  .replace(/<script[^>]*src=["']\.\/city\.js["'][^>]*><\/script>/, '')
  .trim();

const inlineScript = `<script>\n${js}\n</script>`;
const artifact = `${style}\n${bodyInner}\n${inlineScript}\n`;
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Patina — City</title>
${style}
</head>
<body>
${bodyInner}
${inlineScript}
</body>
</html>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'city.art.html'), artifact);
writeFileSync(join(root, 'dist', 'city.html'), standalone);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0);
console.log(`bundled city viewer (three r${esbuild.version ? '' : ''}included)`);
console.log(`  dist/city.html     ${kb(standalone)} KB  (standalone)`);
console.log(`  dist/city.art.html ${kb(artifact)} KB  (Artifact fragment)`);
