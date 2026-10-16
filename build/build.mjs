// Génère le dossier public/ (pages statiques par langue + fichiers statiques).
// Nécessite PHP en ligne de commande (uniquement pour le build, pas pour l'exécution) :
//   sudo apt install php-cli   # ou : brew install php
// Le dossier public/ généré est versionné : tu n'as besoin de PHP que si tu modifies les gabarits.
import { cpSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');
const out = join(root, 'public');

const LANGS = ['ar', 'de', 'en', 'es', 'eu', 'fr', 'it', 'gl', 'kab', 'nl', 'oc', 'pl', 'ro', 'ta', 'tr'];
const PAGES = ['index', 'signature', 'signature-shared', 'organization', 'metadata'];
const SOURCE_URL = process.env.SOURCE_URL || 'https://github.com/TON-COMPTE/signaturepdf-cloudflare';
const BUILD_ID = process.env.BUILD_ID || Date.now().toString(36);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// fichiers statiques (css, js, vendor, logos...) sans le point d'entrée PHP ni la compression serveur
cpSync(join(site, 'public'), out, { recursive: true });
rmSync(join(out, 'index.php'), { force: true });
rmSync(join(out, 'js', 'compress.js'), { force: true });

// PDF de démonstration servis localement
mkdirSync(join(out, 'demo'), { recursive: true });
for (const f of readdirSync(join(site, 'tests'))) {
  if (f.endsWith('.pdf')) cpSync(join(site, 'tests', f), join(out, 'demo', f));
}

// pages rendues
for (const lang of LANGS) {
  for (const page of PAGES) {
    const file = join(out, '_pages', lang, `${page}.html`);
    execFileSync('php', ['-n', join(root, 'build', 'render.php'), lang, page, file], {
      env: { ...process.env, SOURCE_URL, BUILD_ID },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  }
}

writeFileSync(join(out, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
`);

console.log(`OK : ${LANGS.length} langues x ${PAGES.length} pages -> public/ (build ${BUILD_ID})`);
