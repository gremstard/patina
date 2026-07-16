// Bundle the world-map explorer into self-contained HTML.
//
// The page (web/) imports the real src/ modules so it never drifts from the
// tested worldgen. Browsers with native ES modules (Pages) load them directly;
// this bundler inlines everything for two zero-dependency single-file outputs:
//
//   dist/index.html     full standalone <!doctype> doc — GitHub Pages, open in
//                       a browser, or hand to anyone.
//   dist/artifact.html  inner content only (no <html>/<head>/<body>) — for the
//                       Claude Artifact wrapper, which adds those itself.
//
// Inlining = strip `import ... from '...'` and the leading `export ` keyword,
// then concatenate in dependency order. Numeric-only behaviour is untouched, so
// the pinned worldgen is byte-identical to what the determinism test guards.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Dependency order: each module may reference names declared above it.
const MODULES = [
  'src/core/hash.js',
  'src/core/constants.js',
  'src/worldgen/field.js',
  'src/worldgen/names.js',
  'src/core/zoning.js',
  'src/worldgen/worldIndex.js',
  'web/main.js',
];

// Turn one ES module into an IIFE that reads its imports from the shared __SH
// namespace and writes its exports back to it. This preserves per-module scope,
// so module-private helpers (e.g. a `pick` in two files) never collide.
function wrapModule(path, src) {
  const exported = new Set();
  let code = src;

  // Named imports → destructure from __SH. Handles multi-line specifier lists.
  code = code.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"][^'"]+['"];?/g, (_, names) => `const {${names}} = __SH;`);
  // Side-effect / default / namespace imports aren't used here; drop if present.
  code = code.replace(/^\s*import\b[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '');

  // Collect exported names, then strip the `export` keyword / re-export blocks.
  for (const re of [
    /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
    /export\s+class\s+([A-Za-z_$][\w$]*)/g,
  ]) {
    for (const m of code.matchAll(re)) exported.add(m[1]);
  }
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const raw of m[1].split(',')) {
      const nm = raw.trim().split(/\s+as\s+/)[0].trim();
      if (nm) exported.add(nm);
    }
  }
  code = code.replace(/export\s*\{[^}]*\};?/g, '');
  code = code.replace(/export\s+(?=(?:async\s+)?(?:const|let|var|function|class)\b)/g, '');

  const publish = exported.size ? `\nObject.assign(__SH, { ${[...exported].join(', ')} });` : '';
  return `/* ── ${path} ─────────────── */\n;(function(){\n${code}${publish}\n})();\n`;
}

const js = `const __SH = {};\n` + MODULES.map((m) => wrapModule(m, read(m))).join('\n');

// Pull CSS + body markup out of the canonical web/index.html so there is one
// source of truth for style and structure.
const html = read('web/index.html');
const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
const bodyInner = html
  .match(/<body>([\s\S]*?)<\/body>/)[1]
  .replace(/<script[^>]*src=["']\.\/main\.js["'][^>]*><\/script>/, '')
  .trim();

const inlineScript = `<script>\n(function(){\n"use strict";\n${js}\n})();\n</script>`;

// Artifact fragment: no doctype/html/head/body — the wrapper supplies them.
const artifact = `${style}\n${bodyInner}\n${inlineScript}\n`;

// Standalone doc: full page for Pages / direct open.
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Patina — World Map</title>
${style}
</head>
<body>
${bodyInner}
${inlineScript}
</body>
</html>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'artifact.html'), artifact);
writeFileSync(join(root, 'dist', 'index.html'), standalone);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1);
console.log(`bundled ${MODULES.length} modules`);
console.log(`  dist/index.html    ${kb(standalone)} KB  (standalone / Pages)`);
console.log(`  dist/artifact.html ${kb(artifact)} KB  (Artifact fragment)`);
