// Remplace le lien « code source » du pied de page par l'URL de TON dépôt GitHub (obligation AGPL-3.0).
// Usage : npm run set-source -- https://github.com/ton-compte/ton-depot
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv[2];
if (!url || !/^https:\/\/[^\s"'<>]+$/.test(url)) {
  console.error('Usage : npm run set-source -- https://github.com/ton-compte/ton-depot');
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', '_pages');
const PLACEHOLDER = /https:\/\/github\.com\/(TON-COMPTE\/signaturepdf-cloudflare|[^"' <>]+)(?=" *>\s*[^<]*<\/a> \(<a href="https:\/\/github\.com\/24eme)/g;
let n = 0;
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const s = readFileSync(p, 'utf8');
    const t = s.replace(PLACEHOLDER, url);
    if (t !== s) { writeFileSync(p, t); n++; }
  }
})(root);
console.log(`Lien source mis à jour dans ${n} pages -> ${url}`);
