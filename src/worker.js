/*
 * Signature PDF sur Cloudflare — Worker (API de partage + service des pages).
 *
 * Principe : le serveur ne voit JAMAIS le contenu des PDF ni des signatures.
 * Tout est chiffré dans le navigateur (AES-GCM) avec une clé placée dans le fragment #... de l'URL,
 * que le navigateur n'envoie pas au serveur. Le Worker se contente de stocker des blobs opaques
 * (KV) et un petit index (D1), et de purger ce qui a expiré.
 *
 * Licence : AGPL-3.0 (projet dérivé de 24eme/signaturepdf).
 */

const LANGS = ['ar', 'de', 'en', 'es', 'eu', 'fr', 'it', 'gl', 'kab', 'nl', 'oc', 'pl', 'ro', 'ta', 'tr'];
const DEFAULT_LANG = 'fr';

const ID_RE = /^[a-z0-9]{24}$/;
const META_RE = /^[A-Za-z0-9_-]{1,4096}$/;

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function num(env, name, def) {
  const v = parseInt(env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

function secure(headers) {
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  return headers;
}

function json(data, status = 200, extra = {}) {
  const h = secure(new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }));
  return new Response(JSON.stringify(data), { status, headers: h });
}

function bytes(buf, status = 200) {
  const h = secure(new Headers({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }));
  return new Response(buf, { status, headers: h });
}

// ---------------------------------------------------------------- utilitaires crypto
function randomString(len, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789') {
  // rejet pour éviter le biais modulo
  const n = alphabet.length;
  const limit = Math.floor(256 / n) * n;
  let out = '';
  while (out.length < len) {
    const buf = crypto.getRandomValues(new Uint8Array(len * 2));
    for (const b of buf) {
      if (b < limit) {
        out += alphabet[b % n];
        if (out.length === len) break;
      }
    }
  }
  return out;
}

async function sha256Hex(str) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------------------------------------------------------------- verrouillage par mot de passe (SHARE_PASSWORD)
// Si SHARE_PASSWORD est défini : les pages d'outils et la création de partage exigent d'abord /login.
// Les liens de partage (/signature/<id>) restent ouverts à qui possède le lien complet (id + clé dans le #).
const AUTH_COOKIE = 'spauth';

async function authToken(env) {
  return sha256Hex('signaturepdf-gate:' + env.SHARE_PASSWORD);
}

async function isAuthed(request, env) {
  if (!env.SHARE_PASSWORD) return true;
  const c = parseCookies(request.headers.get('Cookie'))[AUTH_COOKIE];
  return !!c && safeEqual(c, await authToken(env));
}

// Limitation des essais de mot de passe : binding « ratelimits » de Workers (LOGIN_LIMITER, voir wrangler.jsonc).
// Absent (tests, ancien déploiement) = pas de limitation côté Worker ; la règle WAF Cloudflare du README reste utile.
async function tooManyAttempts(env, request, scope) {
  if (!env.LOGIN_LIMITER) return false;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const { success } = await env.LOGIN_LIMITER.limit({ key: scope + ':' + ip });
    return !success;
  } catch (e) {
    return false; // en cas d'erreur du limiteur, on ne bloque pas un utilisateur légitime
  }
}

function loginPage(request, message, next, status = 200) {
  const fr = !/^en/i.test(request.headers.get('Accept-Language') || 'fr');
  const t = fr
    ? { title: 'Accès protégé', label: 'Mot de passe', btn: 'Entrer' }
    : { title: 'Protected access', label: 'Password', btn: 'Enter' };
  const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const html = `<!doctype html><html lang="${fr ? 'fr' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${t.title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f5f7;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}form{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 2px 12px #0002;width:min(92vw,340px)}h1{font-size:1.2rem;margin:0 0 1rem}label{display:block;font-size:.85rem;margin-bottom:.3rem}input{width:100%;box-sizing:border-box;padding:.6rem;font-size:1rem;border:1px solid #bbb;border-radius:6px}button{margin-top:1rem;width:100%;padding:.6rem;font-size:1rem;border:0;border-radius:6px;background:#212529;color:#fff;cursor:pointer}.err{color:#b00020;font-size:.85rem;margin-top:.6rem}</style></head>
<body><form method="post" action="/login"><h1>${t.title}</h1><label for="p">${t.label}</label><input id="p" name="password" type="password" autocomplete="current-password" autofocus required><input type="hidden" name="next" value="${esc(next || '/')}"><button type="submit">${t.btn}</button>${message ? `<div class="err">${esc(message)}</div>` : ''}</form></body></html>`;
  const h = secure(new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }));
  return new Response(html, { status, headers: h });
}

function safeNext(v) {
  return typeof v === 'string' && /^\/(?!\/)[^\s\\]*$/.test(v) && !v.startsWith('/login') ? v : '/';
}

async function handleLogin(request, env, url) {
  if (!env.SHARE_PASSWORD) return Response.redirect(new URL('/', url), 302);
  if (request.method === 'POST') {
    let given = '', next = '/';
    if (await tooManyAttempts(env, request, 'login')) {
      const en = /^en/i.test(request.headers.get('Accept-Language') || '');
      return loginPage(request, en ? 'Too many attempts, try again in a minute' : 'Trop de tentatives, réessaie dans une minute', '/', 429);
    }
    try {
      const form = await request.formData();
      given = String(form.get('password') || '');
      next = safeNext(String(form.get('next') || '/'));
    } catch (e) { /* formulaire invalide */ }
    if (safeEqual(await sha256Hex(given), await sha256Hex(env.SHARE_PASSWORD))) {
      const h = secure(new Headers({ Location: next, 'Cache-Control': 'no-store' }));
      h.append('Set-Cookie', `${AUTH_COOKIE}=${await authToken(env)}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`);
      return new Response(null, { status: 303, headers: h });
    }
    return loginPage(request, /^en/i.test(request.headers.get('Accept-Language') || '') ? 'Incorrect password' : 'Mot de passe incorrect', next, 401);
  }
  return loginPage(request, '', safeNext(url.searchParams.get('next') || '/'));
}

function handleLogout(url) {
  const h = secure(new Headers({ Location: '/login', 'Cache-Control': 'no-store' }));
  h.append('Set-Cookie', `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return new Response(null, { status: 303, headers: h });
}

// ---------------------------------------------------------------- pages (HTML statique par langue)
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function pickLang(request, url) {
  const q = url.searchParams.get('lang');
  if (q && LANGS.includes(q)) return { lang: q, remember: true };
  const c = parseCookies(request.headers.get('Cookie')).lang;
  if (c && LANGS.includes(c)) return { lang: c, remember: false };
  const al = request.headers.get('Accept-Language') || '';
  for (const part of al.split(',')) {
    const code = part.split(';')[0].trim().toLowerCase().split('-')[0];
    if (LANGS.includes(code)) return { lang: code, remember: false };
  }
  return { lang: DEFAULT_LANG, remember: false };
}

async function servePage(request, env, url, page) {
  const { lang, remember } = pickLang(request, url);
  const asset = await env.ASSETS.fetch(new Request(new URL(`/_pages/${lang}/${page}.html`, url), { method: 'GET' }));
  if (!asset.ok) return new Response('Page introuvable', { status: 404 });
  const h = secure(new Headers());
  h.set('Content-Type', 'text/html; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  h.set('Vary', 'Accept-Language, Cookie');
  if (remember) h.append('Set-Cookie', `lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
  return new Response(request.method === 'HEAD' ? null : asset.body, { status: 200, headers: h });
}

// ---------------------------------------------------------------- API
async function usedBytes(env) {
  const row = await env.DB.prepare(
    'SELECT (SELECT COALESCE(SUM(size),0) FROM shares) + (SELECT COALESCE(SUM(size),0) FROM layers) AS total'
  ).first();
  return row ? row.total : 0;
}

async function getShare(env, id) {
  if (!ID_RE.test(id)) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT * FROM shares WHERE id = ?1 AND expires_at > ?2').bind(id, now).first();
  return row || null;
}

async function readBody(request, max) {
  const len = parseInt(request.headers.get('Content-Length') || '', 10);
  if (!Number.isFinite(len)) return { error: json({ message: 'Content-Length requis' }, 411) };
  if (len > max) return { error: json({ message: 'Fichier trop volumineux' }, 413) };
  const buf = await request.arrayBuffer();
  if (buf.byteLength > max || buf.byteLength < 29) {
    return { error: json({ message: 'Corps invalide' }, buf.byteLength > max ? 413 : 400) };
  }
  return { buf };
}

async function handleApi(request, env, url) {
  const method = request.method;
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const maxBytes = num(env, 'MAX_BYTES', 20 * 1000 * 1000) + 64; // + IV et tag AES-GCM
  const maxLayers = num(env, 'MAX_LAYERS', 30);
  const maxShares = num(env, 'MAX_SHARES', 300);
  const totalBytes = num(env, 'TOTAL_BYTES', 800 * 1000 * 1000);

  // GET /api/config
  if (parts[0] === 'config' && method === 'GET') {
    const gated = !!env.SHARE_PASSWORD;
    const authed = gated && (await isAuthed(request, env));
    return json({ passwordRequired: gated && !authed, gated, authed, maxBytes: maxBytes - 64, maxLayers });
  }

  if (parts[0] !== 'share') return json({ message: 'Introuvable' }, 404);

  // POST /api/share  (création)
  if (parts.length === 1 && method === 'POST') {
    if (env.SHARE_PASSWORD && !(await isAuthed(request, env))) {
      if (await tooManyAttempts(env, request, 'share')) return json({ message: 'Trop de tentatives' }, 429);
      const given = request.headers.get('X-Share-Password') || '';
      if (!safeEqual(await sha256Hex(given), await sha256Hex(env.SHARE_PASSWORD))) {
        return json({ message: 'Mot de passe de partage incorrect' }, 401);
      }
    }
    const meta = request.headers.get('X-Meta') || '';
    if (!META_RE.test(meta)) return json({ message: 'Métadonnées invalides' }, 400);
    let duration = parseInt(request.headers.get('X-Duration') || '', 10);
    if (!Number.isFinite(duration)) duration = 30 * 86400;
    duration = Math.min(Math.max(duration, 3600), 365 * 86400);

    const { buf, error } = await readBody(request, maxBytes);
    if (error) return error;

    const now = Math.floor(Date.now() / 1000);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM shares WHERE expires_at > ?1').bind(now).first();
    if (count.n >= maxShares || (await usedBytes(env)) + buf.byteLength > totalBytes) {
      return json({ message: 'Stockage plein, réessayez plus tard' }, 507);
    }

    const id = randomString(24);
    const adminKey = randomString(32);
    try {
      await env.BLOBS.put(`o:${id}`, buf);
      await env.DB.prepare(
        'INSERT INTO shares (id, admin_hash, meta, size, duration, layers, created_at, expires_at) VALUES (?1,?2,?3,?4,?5,0,?6,?7)'
      ).bind(id, await sha256Hex(adminKey), meta, buf.byteLength, duration, now, now + duration).run();
    } catch (e) {
      try { await env.BLOBS.delete(`o:${id}`); } catch (_) { /* ignore */ }
      return json({ message: 'Écriture impossible (quota Cloudflare atteint ?)' }, 503);
    }
    return json({ id, adminKey }, 201);
  }

  const id = parts[1];
  if (!id || !ID_RE.test(id)) return json({ message: 'Introuvable' }, 404);

  // DELETE /api/share/:id
  if (parts.length === 2 && method === 'DELETE') {
    const row = await env.DB.prepare('SELECT admin_hash FROM shares WHERE id = ?1').bind(id).first();
    if (!row) return json({ message: 'Introuvable' }, 404);
    const given = await sha256Hex(request.headers.get('X-Admin-Key') || '');
    if (!safeEqual(given, row.admin_hash)) return json({ message: 'Non autorisé' }, 403);
    await deleteShare(env, id);
    return json({ message: 'Document supprimé' });
  }

  const share = await getShare(env, id);
  if (!share) return json({ message: 'Introuvable ou expiré' }, 404);

  // GET /api/share/:id
  if (parts.length === 2 && method === 'GET') {
    return json({ meta: share.meta, layers: share.layers, expires: share.expires_at });
  }

  // GET /api/share/:id/original
  if (parts.length === 3 && parts[2] === 'original' && method === 'GET') {
    const buf = await env.BLOBS.get(`o:${id}`, 'arrayBuffer');
    return buf ? bytes(buf) : json({ message: 'Introuvable' }, 404);
  }

  // POST /api/share/:id/layers
  if (parts.length === 3 && parts[2] === 'layers' && method === 'POST') {
    if (share.layers >= maxLayers) return json({ message: 'Nombre maximal de signatures atteint' }, 409);
    const { buf, error } = await readBody(request, maxBytes);
    if (error) return error;
    if ((await usedBytes(env)) + buf.byteLength > totalBytes) return json({ message: 'Stockage plein' }, 507);

    const kvKey = `l:${id}:${randomString(12)}`;
    try {
      await env.BLOBS.put(kvKey, buf);
    } catch (e) {
      return json({ message: 'Écriture impossible (quota Cloudflare atteint ?)' }, 503);
    }
    const now = Math.floor(Date.now() / 1000);
    const res = await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO layers (share_id, seq, kv_key, size, created_at) SELECT ?1, COALESCE(MAX(seq),0)+1, ?2, ?3, ?4 FROM layers WHERE share_id = ?1'
      ).bind(id, kvKey, buf.byteLength, now),
      env.DB.prepare('UPDATE shares SET layers = layers + 1, expires_at = ?2 + duration WHERE id = ?1').bind(id, now),
      env.DB.prepare('SELECT layers AS n FROM shares WHERE id = ?1').bind(id),
    ]);
    return json({ n: res[2].results[0].n }, 201);
  }

  // GET /api/share/:id/layers/:seq
  if (parts.length === 4 && parts[2] === 'layers' && method === 'GET') {
    const seq = parseInt(parts[3], 10);
    if (!Number.isFinite(seq) || seq < 1) return json({ message: 'Introuvable' }, 404);
    const row = await env.DB.prepare('SELECT kv_key FROM layers WHERE share_id = ?1 AND seq = ?2').bind(id, seq).first();
    if (!row) return json({ message: 'Introuvable' }, 404);
    const buf = await env.BLOBS.get(row.kv_key, 'arrayBuffer');
    return buf ? bytes(buf) : json({ message: 'Pas encore disponible' }, 404);
  }

  return json({ message: 'Méthode non supportée' }, 405);
}

async function deleteShare(env, id) {
  const layers = await env.DB.prepare('SELECT kv_key FROM layers WHERE share_id = ?1').bind(id).all();
  for (const l of layers.results) {
    try { await env.BLOBS.delete(l.kv_key); } catch (_) { /* ignore */ }
  }
  try { await env.BLOBS.delete(`o:${id}`); } catch (_) { /* ignore */ }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM layers WHERE share_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM shares WHERE id = ?1').bind(id),
  ]);
}

/** Purge des partages expirés. Budget d'opérations limité (plan gratuit : 50 sous-requêtes par exécution). */
export async function purgeExpired(env) {
  const now = Math.floor(Date.now() / 1000);
  let budget = 40;
  const expired = await env.DB.prepare('SELECT id, layers FROM shares WHERE expires_at <= ?1 ORDER BY expires_at LIMIT 20').bind(now).all();
  budget -= 1;
  let purged = 0;
  for (const s of expired.results) {
    const need = s.layers + 4;
    if (need > budget) break;
    await deleteShare(env, s.id);
    budget -= need;
    purged++;
  }
  return purged;
}

// ---------------------------------------------------------------- point d'entrée
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path.startsWith('/api/')) {
        return await handleApi(request, env, url);
      }

      if (path === '/login') return await handleLogin(request, env, url);
      if (path === '/logout') return handleLogout(url);
      // Les pages sources ne sont jamais servies directement : uniquement via servePage()
      if (path.startsWith('/_pages/')) return new Response('Introuvable', { status: 404 });

      if (request.method === 'GET' || request.method === 'HEAD') {
        // Lien de partage : ouvert à qui possède le lien complet (id + clé dans le #)
        if (/^\/signature\/[a-z0-9]{10,64}\/?$/.test(path)) return servePage(request, env, url, 'signature-shared');

        const toolPages = { '/': 'index', '/index.html': 'index', '/signature': 'signature', '/signature/': 'signature', '/organization': 'organization', '/metadata': 'metadata', '/shares': 'shares' };
        if (toolPages[path]) {
          if (!(await isAuthed(request, env))) {
            return Response.redirect(new URL('/login?next=' + encodeURIComponent(path === '/index.html' ? '/' : path), url), 303);
          }
          return servePage(request, env, url, toolPages[path]);
        }
      }

      // Tout le reste : fichiers statiques
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return json({ message: 'Erreur interne' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(purgeExpired(env));
  },
};
