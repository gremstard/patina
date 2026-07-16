// Bundle a three.js web app (web/<name>.js + web/<name>.html) into self-contained
// HTML via esbuild — three + the tested src/ modules inlined, no external
// requests (works under the Artifact CSP).
//
//   node scripts/bundle-app.js city
//   node scripts/bundle-app.js drive
//
// Emits dist/<name>.html (standalone) and dist/<name>.art.html (Artifact fragment).

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const name = process.argv[2];
if (!name) {
  console.error('usage: node scripts/bundle-app.js <name>   (e.g. city, drive)');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const result = await esbuild.build({
  entryPoints: [join(root, 'web', `${name}.js`)],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  write: false,
});
const js = result.outputFiles[0].text;

const html = readFileSync(join(root, 'web', `${name}.html`), 'utf8');
const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [, 'Patina'])[1];
const bodyInner = html
  .match(/<body>([\s\S]*?)<\/body>/)[1]
  .replace(new RegExp(`<script[^>]*src=["']\\./${name}\\.js["'][^>]*></script>`), '')
  .trim();

const inlineScript = `<script>\n${js}\n</script>`;
const artifact = `${style}\n${bodyInner}\n${inlineScript}\n`;
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
${style}
</head>
<body>
${bodyInner}
${inlineScript}
</body>
</html>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', `${name}.art.html`), artifact);
writeFileSync(join(root, 'dist', `${name}.html`), standalone);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0);
console.log(`bundled '${name}' (three inlined)`);
console.log(`  dist/${name}.html     ${kb(standalone)} KB  (standalone)`);
console.log(`  dist/${name}.art.html ${kb(artifact)} KB  (Artifact fragment)`);
