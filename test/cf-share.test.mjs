// Tests de cf-share.js sous Node (crypto, fusion de calques avec rotation de page, aller-retour avec le Worker).
// Usage : BASE=http://127.0.0.1:8799 node test/cf-share.test.mjs   (le Worker doit tourner : npm run dev)
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
globalThis.PDFLib = require(join(here, '../site/public/vendor/pdf-lib.min.js'));
const CF = require(join(here, '../site/public/js/cf-share.js'));
const { PDFDocument, degrees } = globalThis.PDFLib;

const BASE = process.env.BASE || '';
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => realFetch(typeof u === 'string' && u.startsWith('/') ? BASE + u : u, o);

let ok = 0;
const check = (name, fn) => fn().then(() => { ok++; console.log('  ✓', name); }, (e) => { console.error('  ✗', name, '\n', e); process.exitCode = 1; });

// PNG RGBA : fond transparent, carré rouge 20x20 en HAUT À GAUCHE de l'image (image 100x140)
function pngTopLeftRed(w = 100, h = 140) {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 4 + 1)] = 0;
        for (let x = 0; x < w; x++) {
            const o = y * (w * 4 + 1) + 1 + x * 4;
            if (x < 20 && y < 20) { raw[o] = 255; raw[o + 1] = 0; raw[o + 2] = 0; raw[o + 3] = 255; }
        }
    }
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = (png) => 'data:image/png;base64,' + png.toString('base64');

async function samplePdf() {
    const doc = await PDFDocument.create();
    // 4 pages 200x280 avec rotations 0/90/180/270 ; la 4e a un CropBox décalé
    for (const rot of [0, 90, 180, 270]) {
        const p = doc.addPage([200, 280]);
        p.setRotation(degrees(rot));
    }
    doc.getPage(3).setCropBox(10, 20, 180, 250);
    return new Uint8Array(await doc.save());
}

console.log('cf-share.js');

await check('chiffrement AES-GCM : aller-retour + mauvaise clé refusée', async () => {
    const k1 = await CF.importKey(CF.generateKey());
    const k2 = await CF.importKey(CF.generateKey());
    const data = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252]);
    const c = await CF.encrypt(k1, data);
    assert.notDeepEqual([...c.slice(12, 20)], [...data]);
    assert.deepEqual([...await CF.decrypt(k1, c)], [...data]);
    await assert.rejects(() => CF.decrypt(k2, c), /key_wrong/);
    await assert.rejects(() => CF.importKey('court'), /key_wrong/);
});

let hasRaster = true;
try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); execFileSync('python3', ['-c', 'import PIL']); } catch (e) { hasRaster = false; console.log('  - test de placement ignoré (pdftoppm ou python3+Pillow absents)'); }

if (hasRaster) await check('fusion de calque : le carré rouge reste en haut à gauche pour chaque rotation de page', async () => {
    const stamped = await CF.stampPdf(await samplePdf(), [{ v: 1, pages: { 0: dataUrl(pngTopLeftRed(100, 140)), 1: dataUrl(pngTopLeftRed(140, 100)), 2: dataUrl(pngTopLeftRed(100, 140)), 3: dataUrl(pngTopLeftRed(140, 100)) } }]);
    const dir = mkdtempSync(join(tmpdir(), 'cf-'));
    writeFileSync(join(dir, 's.pdf'), stamped);
    execFileSync('pdftoppm', ['-r', '72', '-cropbox', '-png', join(dir, 's.pdf'), join(dir, 'p')]);
    const py = `
import sys, glob
from PIL import Image
for f in sorted(glob.glob(sys.argv[1]+'/p-*.png')):
    im = Image.open(f).convert('RGB'); w,h = im.size
    red=[(x,y) for y in range(h) for x in range(w) if im.getpixel((x,y))[0]>200 and im.getpixel((x,y))[1]<60 and im.getpixel((x,y))[2]<60]
    xs=[p[0] for p in red]; ys=[p[1] for p in red]
    print(f.split('/')[-1], w, h, len(red), min(xs) if xs else -1, min(ys) if ys else -1, max(xs) if xs else -1, max(ys) if ys else -1)
`;
    const out = execFileSync('python3', ['-c', py, dir]).toString().trim().split('\n');
    out.forEach((l) => console.log('      ', l));
    assert.equal(out.length, 4);
    for (const l of out) {
        const [, w, h, n, x0, y0, x1, y1] = l.split(' ').map((v, i) => (i ? Number(v) : v));
        assert.ok(n > 50, 'pas de pixels rouges : ' + l);
        // le carré (20/100 de la largeur affichée) doit être dans le coin haut-gauche de la page affichée
        assert.ok(x0 <= 6 && y0 <= 6, 'carré mal placé (attendu haut-gauche) : ' + l);
        assert.ok(x1 < w * 0.45 && y1 < h * 0.45, 'carré mal dimensionné : ' + l);
    }
});

if (BASE) {
    await check('Worker : partage chiffré, 2 signatures, lecture incrémentale, suppression', async () => {
        const pdf = await samplePdf();
        const layer1 = { v: 1, pages: { 0: dataUrl(pngTopLeftRed()) } };
        const res = await CF.createShare({ pdfBytes: pdf, filename: 'contrat.pdf', duration: '+1 week', password: process.env.PW || '', layer: layer1 });
        assert.match(res.id, /^[a-z0-9]{24}$/);

        // ce que le serveur stocke ne doit rien révéler
        const raw = new Uint8Array(await (await realFetch(`${BASE}/api/share/${res.id}/original`)).arrayBuffer());
        assert.ok(!Buffer.from(raw).includes('%PDF'), 'le PDF est stocké en clair !');

        const st = CF.newShareState(res.id, res.key);
        await CF.refreshShare(st);
        assert.equal(st.filename, 'contrat.pdf');
        assert.equal(st.count, 1);
        assert.deepEqual([...st.original], [...pdf]);
        const stamped1 = st.stamped;

        await CF.postLayer(res.id, st.key, { v: 1, pages: { 1: dataUrl(pngTopLeftRed(140, 100)) } });
        await CF.refreshShare(st);
        assert.equal(st.count, 2);
        assert.equal(st.layers.length, 2);
        assert.ok(st.stamped.length > stamped1.length);
        assert.equal(CF.signedFilename(st.filename, st.count), 'contrat_signe-2x.pdf');

        // mauvaise clé
        const bad = CF.newShareState(res.id, CF.generateKey());
        await assert.rejects(() => CF.refreshShare(bad), /key_wrong/);
        // sans clé
        await assert.rejects(() => CF.refreshShare(CF.newShareState(res.id, '')), /key_missing/);

        const del = await realFetch(`${BASE}/api/share/${res.id}`, { method: 'DELETE', headers: { 'X-Admin-Key': res.adminKey } });
        assert.equal(del.status, 200);
        await assert.rejects(() => CF.refreshShare(CF.newShareState(res.id, res.key)), /load_failed/);
    });
}

console.log(process.exitCode ? 'ÉCHEC' : `OK (${ok} tests)`);
