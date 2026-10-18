/*
 * cf-share.js — couche « Cloudflare » de Signature PDF (portage sans PHP).
 *
 * Tout ce qui demandait des programmes serveur (pdftk, rsvg-convert, gpg, potrace, ghostscript)
 * est fait ici, dans le navigateur :
 *   - chiffrement AES-GCM des PDF partagés (la clé reste dans le fragment #... de l'URL,
 *     elle n'est jamais envoyée au serveur)
 *   - fusion des calques de signature dans le PDF (pdf-lib)
 *   - mise « à plat » du PDF (rasterisation avec pdf.js) pour les zones masquées / filigranes
 *   - vectorisation simple d'une image de signature
 *
 * Licence : AGPL-3.0 (comme le projet amont 24eme/signaturepdf).
 */
(function (root) {
    'use strict';

    // ---------------------------------------------------------------- i18n (nouveaux textes)
    const I18N = {
        fr: {
            share_password: 'Mot de passe de partage',
            share_failed: "Impossible de créer le partage",
            share_password_wrong: 'Mot de passe de partage incorrect',
            load_failed: "Impossible de charger ce document partagé. Le lien est peut-être expiré ou incomplet.",
            key_missing: "Il manque la clé de chiffrement dans le lien (la partie après #). Demandez le lien complet.",
            key_wrong: "La clé de chiffrement de ce lien est incorrecte.",
            transmit_failed: "Impossible de transmettre la signature",
            too_big: "Le PDF est trop volumineux pour le partage",
            flatten_failed: "Impossible d'aplatir le PDF",
            sign_failed: "Impossible de générer le PDF signé",
            too_many_layers: "Ce document a atteint le nombre maximal de signatures",
        },
        en: {
            share_password: 'Sharing password',
            share_failed: 'Unable to create the share',
            share_password_wrong: 'Wrong sharing password',
            load_failed: 'Unable to load this shared document. The link may have expired or be incomplete.',
            key_missing: 'The encryption key is missing from the link (the part after #). Ask for the full link.',
            key_wrong: 'The encryption key in this link is wrong.',
            transmit_failed: 'Unable to send the signature',
            too_big: 'The PDF is too large to be shared',
            flatten_failed: 'Unable to flatten the PDF',
            sign_failed: 'Unable to generate the signed PDF',
            too_many_layers: 'This document reached the maximum number of signatures',
        },
    };
    function lang() {
        const l = ((root.document && root.document.documentElement.lang) || 'en').toLowerCase().split('-')[0];
        return I18N[l] ? l : 'en';
    }
    function t(k) { return I18N[lang()][k] || I18N.en[k] || k; }

    // ---------------------------------------------------------------- base64url
    function b64uEncode(bytes) {
        let s = '';
        const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) {
            s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        }
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function b64uDecode(str) {
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) str += '=';
        const bin = atob(str);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    // ---------------------------------------------------------------- crypto AES-GCM
    function generateKey() {
        return b64uEncode(root.crypto.getRandomValues(new Uint8Array(32)));
    }
    async function importKey(keyStr) {
        let raw;
        try { raw = b64uDecode(keyStr); } catch (e) { throw new Error('key_wrong'); }
        if (raw.length !== 32) throw new Error('key_wrong');
        return root.crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }
    async function encrypt(key, bytes) {
        const iv = root.crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
        const out = new Uint8Array(12 + ct.length);
        out.set(iv, 0);
        out.set(ct, 12);
        return out;
    }
    async function decrypt(key, bytes) {
        if (bytes.length < 29) throw new Error('key_wrong');
        try {
            return new Uint8Array(await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
        } catch (e) {
            throw new Error('key_wrong');
        }
    }
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    // ---------------------------------------------------------------- API
    async function api(path, opts) {
        const r = await fetch('/api' + path, Object.assign({ cache: 'no-store' }, opts || {}));
        return r;
    }

    async function getConfig() {
        try {
            const r = await api('/config');
            if (r.ok) return await r.json();
        } catch (e) { /* ignore */ }
        return { passwordRequired: false, maxBytes: 20 * 1000 * 1000, maxLayers: 50 };
    }

    const DURATIONS = {
        '+1 year': 31536000, '+6 month': 15552000, '+6 months': 15552000, '+1 month': 2592000,
        '+1 week': 604800, '+1 day': 86400, '+1 hour': 3600,
    };
    function durationToSeconds(v) { return DURATIONS[v] || 2592000; }

    /** Crée un partage. Retourne { id, adminKey, key }. */
    async function createShare({ pdfBytes, filename, duration, password, layer, perms, notify, notifyEvents }) {
        const cfg = await getConfig();
        if (pdfBytes.length + 64 > cfg.maxBytes) throw new Error('too_big');
        const keyStr = generateKey();
        const key = await importKey(keyStr);
        const encPdf = await encrypt(key, pdfBytes);
        const encMeta = await encrypt(key, enc.encode(JSON.stringify({ filename, v: 2, perms: perms || {}, nodl: !!(perms && perms.dl === false) })));
        const headers = {
            'Content-Type': 'application/octet-stream',
            'X-Duration': String(durationToSeconds(duration)),
            'X-Meta': b64uEncode(encMeta),
            'X-Notify': notify || 'none',
            'X-Notify-Events': notifyEvents || '',
        };
        if (password) headers['X-Share-Password'] = password;
        const r = await api('/share', { method: 'POST', headers, body: encPdf });
        if (r.status === 401) throw new Error('share_password_wrong');
        if (r.status === 413) throw new Error('too_big');
        if (!r.ok) throw new Error('share_failed');
        const { id, adminKey } = await r.json();
        if (layer) {
            await postLayer(id, key, layer);
        }
        return { id, adminKey, key: keyStr };
    }

    async function postLayer(id, key, layer) {
        const body = await encrypt(key, enc.encode(JSON.stringify(layer)));
        const r = await api('/share/' + id + '/layers', {
            method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body,
        });
        if (r.status === 409) throw new Error('too_many_layers');
        if (r.status === 413) throw new Error('too_big');
        if (!r.ok) throw new Error('transmit_failed');
        return (await r.json()).n;
    }

    async function getBytesRetry(path, tries = 6) {
        for (let i = 0; i < tries; i++) {
            const r = await api(path);
            if (r.ok) return new Uint8Array(await r.arrayBuffer());
            // KV est « éventuellement cohérent » : une couche toute juste écrite peut mettre quelques secondes à apparaître
            if (r.status !== 404 || i === tries - 1) throw new Error('load_failed');
            await new Promise((res) => setTimeout(res, 1500));
        }
        throw new Error('load_failed');
    }

    /** État d'un partage chargé (pour ne retélécharger que les nouvelles couches). */
    function newShareState(id, keyStr) {
        return { id, keyStr, key: null, filename: 'document.pdf', original: null, layers: [], count: 0, stamped: null };
    }

    /** Récupère l'info légère d'un partage ({ meta, layers, expires }). */
    async function fetchInfo(id) {
        const r = await api('/share/' + id);
        if (!r.ok) throw new Error('load_failed');
        return r.json();
    }

    /** Charge / met à jour un partage et reconstruit le PDF signé. */
    async function refreshShare(state) {
        if (!state.keyStr) throw new Error('key_missing');
        if (!state.key) state.key = await importKey(state.keyStr);
        const info = await fetchInfo(state.id);
        if (!state.original) {
            const meta = JSON.parse(dec.decode(await decrypt(state.key, b64uDecode(info.meta))));
            state.filename = meta.filename || state.filename;
            state.perms = meta.perms || { dl: !meta.nodl };
            state.noDownload = state.perms.dl === false;
            state.original = await decrypt(state.key, await getBytesRetry('/share/' + state.id + '/original'));
        }
        let changed = state.stamped === null;
        for (let seq = state.layers.length + 1; seq <= info.layers; seq++) {
            const raw = await getBytesRetry('/share/' + state.id + '/layers/' + seq);
            state.layers.push(JSON.parse(dec.decode(await decrypt(state.key, raw))));
            changed = true;
        }
        state.count = info.layers;
        if (changed) {
            state.stamped = await stampPdf(state.original, state.layers);
        }
        return state;
    }

    function signedFilename(filename, n) {
        return filename.replace(/\.pdf$/i, '') + '_signe-' + n + 'x.pdf';
    }

    // ---------------------------------------------------------------- calques (overlays)
    /** Transforme les canvas fabric.js en « calque » { v, pages: { index: dataURL PNG } }. */
    function buildLayer(canvases) {
        const pages = {};
        let any = false;
        canvases.forEach(function (c, i) {
            if (!c.getObjects().length && !c.overlayImage) return;
            c.discardActiveObject();
            c.renderAll();
            const m = Math.min(3, Math.max(1, 2200 / c.getWidth()));
            pages[i] = c.toDataURL({ format: 'png', multiplier: m });
            any = true;
        });
        return any ? { v: 1, pages } : null;
    }

    /** Dessine une image (orientée comme à l'écran) sur une page, en tenant compte de /Rotate et du CropBox. */
    function drawOverlay(page, image) {
        const { degrees } = root.PDFLib;
        const box = page.getCropBox();
        const W = box.width, H = box.height;
        const r = (((page.getRotation().angle % 360) + 360) % 360);
        const o = { x: box.x, y: box.y };
        if (r === 0) {
            page.drawImage(image, { x: o.x, y: o.y, width: W, height: H });
        } else if (r === 90) {
            page.drawImage(image, { x: o.x + W, y: o.y, width: H, height: W, rotate: degrees(90) });
        } else if (r === 180) {
            page.drawImage(image, { x: o.x + W, y: o.y + H, width: W, height: H, rotate: degrees(180) });
        } else { // 270
            page.drawImage(image, { x: o.x, y: o.y + H, width: H, height: W, rotate: degrees(270) });
        }
    }

    /** Applique les calques sur le PDF d'origine. Retourne un Uint8Array. */
    async function stampPdf(pdfBytes, layers) {
        const { PDFDocument } = root.PDFLib;
        const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
        const pages = doc.getPages();
        for (const layer of layers) {
            for (const idx of Object.keys(layer.pages)) {
                const page = pages[parseInt(idx, 10)];
                if (!page) continue;
                const img = await doc.embedPng(layer.pages[idx]);
                drawOverlay(page, img);
            }
        }
        return doc.save();
    }

    /** Rend le PDF « à plat » (pages rasterisées à 200 dpi) : supprime réellement le contenu masqué. */
    async function flattenPdf(pdfBytes) {
        const { PDFDocument } = root.PDFLib;
        const pdf = await root.pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
        const out = await PDFDocument.create();
        const scale = 200 / 72;
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const vp1 = page.getViewport({ scale: 1 });
            const vp = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(vp.width);
            canvas.height = Math.ceil(vp.height);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;
            const jpg = canvas.toDataURL('image/jpeg', 0.92);
            canvas.width = canvas.height = 0;
            const img = await out.embedJpg(jpg);
            const op = out.addPage([vp1.width, vp1.height]);
            op.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
        }
        return out.save();
    }

    // ---------------------------------------------------------------- vectorisation d'image (signature)
    /**
     * Transforme une image (tracé, scan) en SVG noir sur transparent : seuillage puis fusion des
     * pixels « encre » en bandes horizontales. Garde la signature recolorable comme avec potrace.
     */
    async function vectorizeImage(file, maxDim) {
        maxDim = maxDim || 1400;
        const bmp = await createImageBitmap(file);
        const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * k));
        const h = Math.max(1, Math.round(bmp.height * k));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bmp, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        // niveaux de gris + seuil d'Otsu
        const gray = new Uint8Array(w * h);
        const hist = new Array(256).fill(0);
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
            const g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            gray[j] = g; hist[g]++;
        }
        let total = w * h, sum = 0;
        for (let i = 0; i < 256; i++) sum += i * hist[i];
        let sumB = 0, wB = 0, best = 0, thr = 128;
        for (let i = 0; i < 256; i++) {
            wB += hist[i]; if (!wB) continue;
            const wF = total - wB; if (!wF) break;
            sumB += i * hist[i];
            const mB = sumB / wB, mF = (sum - sumB) / wF;
            const between = wB * wF * (mB - mF) * (mB - mF);
            if (between > best) { best = between; thr = i; }
        }
        thr = Math.min(thr, 200);
        let d = '';
        for (let y = 0; y < h; y++) {
            let x = 0;
            while (x < w) {
                if (gray[y * w + x] <= thr) {
                    let x2 = x;
                    while (x2 < w && gray[y * w + x2] <= thr) x2++;
                    d += 'M' + x + ' ' + y + 'h' + (x2 - x) + 'v1h-' + (x2 - x) + 'z';
                    x = x2;
                } else { x++; }
            }
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'
            + '<path d="' + d + '" fill="#000000" shape-rendering="crispEdges"/></svg>';
    }

    // ---------------------------------------------------------------- clé de partage (fragment d'URL)
    function resolveShareKey(id) {
        const hash = (root.location.hash || '').replace(/^#/, '');
        try {
            if (hash) {
                root.localStorage.setItem('cfkey.' + id, hash);
                return hash;
            }
            return root.localStorage.getItem('cfkey.' + id) || '';
        } catch (e) {
            return hash;
        }
    }

    root.CF = {
        t, b64uEncode, b64uDecode, generateKey, importKey, encrypt, decrypt,
        getConfig, createShare, postLayer, newShareState, refreshShare, fetchInfo, signedFilename,
        buildLayer, stampPdf, flattenPdf, drawOverlay, vectorizeImage, resolveShareKey, durationToSeconds,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.CF;
})(typeof window !== 'undefined' ? window : globalThis);
