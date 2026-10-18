// Tests d'intégration du Worker : verrouillage par mot de passe, cycle de vie d'un partage, limitation des essais.
// Démarre `wrangler dev --local` tout seul (base D1 et KV simulées en local, rien n'est envoyé à Cloudflare).
// Usage : node test/worker.test.mjs
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const PORT = process.env.PORT || '8798';
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'mot-de-passe-de-test';

// Faux serveur Gotify : enregistre les messages reçus
const gotifyMessages = [];
const gotify = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => { gotifyMessages.push({ url: req.url, key: req.headers['x-gotify-key'], body: JSON.parse(body || '{}') }); res.end('{}'); });
});
await new Promise((r) => gotify.listen(0, '127.0.0.1', r));
const GOTIFY_PORT = gotify.address().port;

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.error('  ✗', name, '\n   ', e.message); }
}
const get = (path, headers = {}) => fetch(BASE + path, { redirect: 'manual', headers });
const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

// Le compteur de limitation est conservé sur disque : on le remet à zéro pour que deux exécutions rapprochées ne se gênent pas
rmSync(join(root, '.wrangler', 'state', 'v3', 'ratelimit'), { recursive: true, force: true });
execFileSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'signaturepdf', '--local'], { cwd: root, stdio: 'ignore' });
const dev = spawn(process.execPath, [wrangler, 'dev', '--local', '--test-scheduled', '--port', PORT, '--ip', '127.0.0.1', '--var', `SHARE_PASSWORD:${PW}`, '--var', `GOTIFY_URL:http://127.0.0.1:${GOTIFY_PORT}`, '--var', 'GOTIFY_TOKEN:jeton-test'], { cwd: root, stdio: process.env.TEST_DEBUG ? 'inherit' : 'ignore' });
const stop = () => { try { dev.kill('SIGTERM'); } catch (e) { /* déjà arrêté */ } try { gotify.close(); } catch (e) { /* ignore */ } };
process.on('exit', stop);

async function waitReady() {
  for (let i = 0; i < 90; i++) {
    try { if ((await get('/api/config')).ok) return; } catch (e) { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Le Worker local ne démarre pas');
}

try {
  await waitReady();
  console.log('Worker local prêt, mot de passe actif');

  await test('les pages d’outils redirigent vers /login sans connexion', async () => {
    for (const p of ['/', '/signature', '/organization', '/metadata', '/shares']) {
      const r = await get(p);
      assert.equal(r.status, 303, p);
      assert.match(r.headers.get('location'), /\/login\?next=/, p);
    }
  });
  await test('les pages sources /_pages/ ne sont pas accessibles directement', async () => {
    assert.equal((await get('/_pages/fr/index.html')).status, 404);
  });
  await test('/api/config annonce un site verrouillé et non connecté', async () => {
    const c = await (await get('/api/config')).json();
    assert.equal(c.gated, true); assert.equal(c.authed, false); assert.equal(c.passwordRequired, true);
  });
  await test('créer un partage sans connexion ni mot de passe est refusé', async () => {
    const r = await fetch(BASE + '/api/share', { method: 'POST', headers: { 'X-Meta': 'abc', 'X-Duration': '3600' }, body: new Uint8Array(40) });
    assert.equal(r.status, 401);
  });

  let cookie = '';
  await test('mauvais mot de passe refusé, bon mot de passe accepté avec cookie HttpOnly/Secure', async () => {
    const bad = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ password: 'non', next: '/' }) });
    assert.equal(bad.status, 401);
    const good = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ password: PW, next: '/signature' }) });
    assert.equal(good.status, 303);
    assert.equal(good.headers.get('location'), '/signature');
    const sc = good.headers.get('set-cookie');
    assert.match(sc, /HttpOnly/); assert.match(sc, /Secure/); assert.match(sc, /SameSite=Lax/);
    cookie = cookieFrom(good);
    assert.ok(cookie.startsWith('spauth='));
  });
  await test('redirection ouverte refusée (next=//evil.example)', async () => {
    const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ password: PW, next: '//evil.example' }) });
    if (r.status === 303) assert.equal(r.headers.get('location'), '/');
  });
  await test('connecté : toutes les pages d’outils s’ouvrent, y compris Mes partages', async () => {
    for (const p of ['/', '/signature', '/organization', '/metadata', '/shares']) {
      const r = await get(p, { Cookie: cookie });
      assert.equal(r.status, 200, p);
      assert.match(await r.text(), /<html/, p);
    }
  });
  await test('connecté : /api/config n’exige plus le mot de passe dans la fenêtre de partage', async () => {
    const c = await (await get('/api/config', { Cookie: cookie })).json();
    assert.equal(c.authed, true); assert.equal(c.passwordRequired, false);
  });

  let id, adminKey;
  await test('cycle de partage : créer, lire, signer, supprimer', async () => {
    const pdf = new Uint8Array(100).fill(7);
    const created = await fetch(BASE + '/api/share', { method: 'POST', headers: { Cookie: cookie, 'X-Meta': 'bWV0YQ', 'X-Duration': '3600' }, body: pdf });
    assert.equal(created.status, 201);
    ({ id, adminKey } = await created.json());
    assert.match(id, /^[a-z0-9]{24}$/);

    // un signataire sans cookie ouvre le lien de partage et lit le contenu chiffré
    assert.equal((await get('/signature/' + id)).status, 200);
    const info = await (await get('/api/share/' + id)).json();
    assert.equal(info.layers, 0);
    const orig = new Uint8Array(await (await get('/api/share/' + id + '/original')).arrayBuffer());
    assert.deepEqual([...orig], [...pdf]);

    const layer = await fetch(BASE + '/api/share/' + id + '/layers', { method: 'POST', body: new Uint8Array(30).fill(9) });
    assert.equal(layer.status, 201);
    assert.equal((await layer.json()).n, 1);
    assert.equal((await (await get('/api/share/' + id)).json()).layers, 1);

    const wrong = await fetch(BASE + '/api/share/' + id, { method: 'DELETE', headers: { 'X-Admin-Key': 'x'.repeat(32) } });
    assert.equal(wrong.status, 403);
    const del = await fetch(BASE + '/api/share/' + id, { method: 'DELETE', headers: { 'X-Admin-Key': adminKey } });
    assert.ok(del.ok);
    assert.equal((await get('/api/share/' + id)).status, 404);
  });

  await test('notifications Gotify : à chaque signature, message final à N, les deux, option invalide refusée', async () => {
    assert.equal((await (await get('/api/config')).json()).notify, true);
    const create = (notify) => fetch(BASE + '/api/share', { method: 'POST', headers: { Cookie: cookie, 'X-Meta': 'bWV0YQ', 'X-Duration': '3600', 'X-Notify': notify }, body: new Uint8Array(50) });
    const sign = (id) => fetch(BASE + '/api/share/' + id + '/layers', { method: 'POST', body: new Uint8Array(30).fill(3) });
    const waitFor = async (n) => { for (let i = 0; i < 30 && gotifyMessages.length < n; i++) await new Promise((r) => setTimeout(r, 100)); };

    assert.equal((await create('invalide')).status, 400);

    const a = await (await create('count:2')).json();
    await sign(a.id);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(gotifyMessages.length, 0, 'pas de message avant le seuil');
    await sign(a.id);
    await waitFor(1);
    assert.equal(gotifyMessages.length, 1);
    assert.equal(gotifyMessages[0].url, '/message');
    assert.equal(gotifyMessages[0].key, 'jeton-test');
    assert.match(gotifyMessages[0].body.message, /2 signature/);
    assert.ok(!JSON.stringify(gotifyMessages[0].body).includes(a.id), 'le message ne contient pas l’identifiant du partage');

    const b = await (await create('each')).json();
    await sign(b.id); await sign(b.id);
    await waitFor(3);
    assert.equal(gotifyMessages.length, 3);

    const d = await (await create('each+count:3')).json();
    await sign(d.id); await sign(d.id); await sign(d.id);
    await waitFor(6);
    assert.equal(gotifyMessages.length, 6, 'chaque signature + un seul message final (pas de doublon à la 3e)');
    assert.ok(gotifyMessages.slice(3).some((m) => /Terminé/.test(m.body.message)), 'message final envoyé');

    const c = await (await create('none')).json();
    await sign(c.id);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(gotifyMessages.length, 6, 'aucune notification demandée');
    for (const x of [a, b, c, d]) await fetch(BASE + '/api/share/' + x.id, { method: 'DELETE', headers: { 'X-Admin-Key': x.adminKey } });
  });

  await test('premier accès, alerte avant expiration, durée modifiable, duplication', async () => {
    const create = (events, duration = '3600') => fetch(BASE + '/api/share', { method: 'POST', headers: { Cookie: cookie, 'X-Meta': 'bWV0YQ', 'X-Duration': duration, 'X-Notify': 'none', 'X-Notify-Events': events }, body: new Uint8Array(50).fill(7) });
    const waitFor = async (n) => { for (let i = 0; i < 30 && gotifyMessages.length < n; i++) await new Promise((r) => setTimeout(r, 100)); };
    const cron = () => fetch(BASE + '/cdn-cgi/handler/scheduled');
    const pause = () => new Promise((r) => setTimeout(r, 600));
    assert.equal((await create('n-importe-quoi')).status, 400);

    // premier accès : un seul message, même si le lien est ouvert plusieurs fois
    const a = await (await create('open')).json();
    const n0 = gotifyMessages.length;
    assert.equal((await fetch(BASE + '/api/share/' + a.id + '/opened', { method: 'POST' })).status, 200);
    await waitFor(n0 + 1);
    assert.equal(gotifyMessages.length, n0 + 1);
    assert.match(gotifyMessages[n0].body.message, /première fois/);
    await fetch(BASE + '/api/share/' + a.id + '/opened', { method: 'POST' });
    await pause();
    assert.equal(gotifyMessages.length, n0 + 1, 'pas de second message');

    // alerte d'expiration : partage d'1 h sans signature -> prévenu une fois ; avec une signature -> jamais
    const b = await (await create('expire')).json();
    const c = await (await create('expire')).json();
    await fetch(BASE + '/api/share/' + c.id + '/layers', { method: 'POST', body: new Uint8Array(30).fill(3) });
    await pause();
    const n1 = gotifyMessages.length;
    await cron();
    await waitFor(n1 + 1);
    assert.equal(gotifyMessages.length, n1 + 1, 'un seul partage concerné');
    assert.match(gotifyMessages[n1].body.message, /expire dans moins de 24/);
    await cron();
    await pause();
    assert.equal(gotifyMessages.length, n1 + 1, 'pas de doublon à la passe suivante');

    // durée : refusée sans clé d'administration ou invalide, sinon l'expiration est recalculée à partir de maintenant
    const dur = (id, key, body) => fetch(BASE + '/api/share/' + id + '/duration', { method: 'POST', headers: { 'X-Admin-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await dur(b.id, 'mauvaise-cle', { duration: 86400 })).status, 403);
    assert.equal((await dur(b.id, b.adminKey, { duration: 'abc' })).status, 400);
    const now = Math.floor(Date.now() / 1000);
    const ok = await (await dur(b.id, b.adminKey, { duration: 7 * 86400 })).json();
    assert.ok(Math.abs(ok.expires - (now + 7 * 86400)) < 30);
    assert.equal((await (await fetch(BASE + '/api/share/' + b.id)).json()).expires, ok.expires);
    // 7 jours : plus dans la fenêtre de 24 h, puis ré-armée : raccourcie à 1 h, elle prévient de nouveau
    await dur(b.id, b.adminKey, { duration: 3600 });
    const n2 = gotifyMessages.length;
    await cron();
    await waitFor(n2 + 1);
    assert.equal(gotifyMessages.length, n2 + 1, 'alerte ré-armée après changement de durée');

    // duplication : nouveau lien, même document chiffré, sans signature
    assert.equal((await fetch(BASE + '/api/share/' + c.id + '/duplicate', { method: 'POST', headers: { 'X-Admin-Key': 'mauvaise-cle' } })).status, 403);
    const dup = await fetch(BASE + '/api/share/' + c.id + '/duplicate', { method: 'POST', headers: { 'X-Admin-Key': c.adminKey } });
    assert.equal(dup.status, 201);
    const d = await dup.json();
    assert.notEqual(d.id, c.id);
    assert.equal((await (await fetch(BASE + '/api/share/' + d.id)).json()).layers, 0, 'sans les signatures');
    const o1 = new Uint8Array(await (await fetch(BASE + '/api/share/' + c.id + '/original')).arrayBuffer());
    const o2 = new Uint8Array(await (await fetch(BASE + '/api/share/' + d.id + '/original')).arrayBuffer());
    assert.deepEqual(o2, o1);
    for (const x of [a, b, c, d]) await fetch(BASE + '/api/share/' + x.id, { method: 'DELETE', headers: { 'X-Admin-Key': x.adminKey } });
  });

  await test('diagnostic des notifications : statut, test d’envoi, accès réservé aux sessions connectées', async () => {
    assert.equal((await fetch(BASE + '/api/notify/status')).status, 401);
    assert.equal((await fetch(BASE + '/api/notify/test', { method: 'POST' })).status, 401);
    const before = gotifyMessages.length;
    const t = await (await fetch(BASE + '/api/notify/test', { method: 'POST', headers: { Cookie: cookie } })).json();
    assert.equal(t.ok, true); assert.equal(t.status, 200);
    assert.equal(gotifyMessages.length, before + 1);
    assert.deepEqual(Object.keys(gotifyMessages[before].body).sort(), ['message', 'priority', 'title']);
    const st = await (await fetch(BASE + '/api/notify/status', { headers: { Cookie: cookie } })).json();
    assert.equal(st.available, true); assert.equal(st.last.outcome, 'test-sent');
  });

  await test('la déconnexion efface le cookie', async () => {
    const r = await get('/logout', { Cookie: cookie });
    assert.equal(r.status, 303);
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  });

  await test('limitation : les essais répétés de mot de passe finissent en 429', async () => {
    const codes = [];
    for (let i = 0; i < 8; i++) {
      const r = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ password: 'faux' + i, next: '/' }) });
      codes.push(r.status);
    }
    assert.ok(codes.includes(429), 'aucun 429 dans ' + codes.join(','));
  });
} finally {
  stop();
}
console.log(`\n${passed} réussi(s), ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
