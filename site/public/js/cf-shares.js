/*
 * Page « Mes partages » (AGPL-3.0-or-later).
 * Liste les partages dont ce navigateur connaît la clé (stockée en local, jamais envoyée au serveur),
 * déchiffre le nom du fichier sur place, affiche l'expiration et permet de supprimer un partage.
 */
(function (root) {
    'use strict';
    const doc = root.document;
    const CF = root.CF, CFX = root.CFX;
    const dec = new TextDecoder();

    function storedShares() {
        const out = [];
        try {
            for (let i = 0; i < root.localStorage.length; i++) {
                const m = /^cfkey\.([a-z0-9]{24})$/.exec(root.localStorage.key(i) || '');
                if (m) out.push({ id: m[1], key: root.localStorage.getItem('cfkey.' + m[1]) || '', admin: root.localStorage.getItem(m[1] + '.adminKey') || '' });
            }
        } catch (e) { /* stockage indisponible */ }
        return out;
    }
    function forget(id) {
        try { root.localStorage.removeItem('cfkey.' + id); root.localStorage.removeItem(id + '.adminKey'); root.localStorage.removeItem('cfinfo.' + id); } catch (e) { /* ignore */ }
    }
    function cachedInfo(id) {
        try { return JSON.parse(root.localStorage.getItem('cfinfo.' + id) || '{}') || {}; } catch (e) { return {}; }
    }
    function cacheInfo(id, info) {
        try { root.localStorage.setItem('cfinfo.' + id, JSON.stringify(info)); } catch (e) { /* ignore */ }
    }

    function el(tag, cls, text) {
        const e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function button(icon, label, cls) {
        const b = el('button', 'btn btn-sm ' + (cls || 'btn-outline-dark'));
        b.type = 'button';
        const i = el('i', 'bi ' + icon);
        b.appendChild(i);
        b.appendChild(doc.createTextNode(' ' + label));
        return b;
    }
    function linkButton(icon, label, href, cls) {
        const a = el('a', 'btn btn-sm ' + (cls || 'btn-outline-dark'));
        a.href = href;
        a.appendChild(el('i', 'bi ' + icon));
        a.appendChild(doc.createTextNode(' ' + label));
        return a;
    }

    async function readInfo(share) {
        const r = await fetch('/api/share/' + share.id, { cache: 'no-store' });
        if (r.status === 404) return { gone: true, cached: cachedInfo(share.id) };
        if (!r.ok) throw new Error('load_error');
        const info = await r.json();
        let filename = '';
        try {
            const key = await CF.importKey(share.key);
            const meta = JSON.parse(dec.decode(await CF.decrypt(key, CF.b64uDecode(info.meta))));
            filename = String(meta.filename || '');
        } catch (e) { /* clé incorrecte : on affiche un nom générique */ }
        const known = cachedInfo(share.id);
        filename = filename || known.filename || '';
        cacheInfo(share.id, { filename, layers: info.layers, expires: info.expires });
        return { gone: false, layers: info.layers, expires: info.expires, filename };
    }

    function expiryText(expires) {
        const d = new Date(expires * 1000);
        const days = Math.ceil((expires * 1000 - Date.now()) / 86400000);
        const when = CFX.t('expires_on', d.toLocaleString(doc.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'short' }));
        return when + ' ' + (days <= 0 ? CFX.t('expires_today') : CFX.t('expires_in_days', String(days)));
    }

    function card(share, info, onRemoved) {
        const link = root.location.origin + '/signature/' + share.id + '#' + share.key;
        const col = el('div', 'col-12 col-lg-6');
        const c = el('div', 'card shadow-sm h-100');
        const body = el('div', 'card-body');
        col.appendChild(c); c.appendChild(body);

        const head = el('div', 'd-flex justify-content-between align-items-start gap-2');
        const known = info.gone ? (info.cached || {}) : null;
        const title = el('h2', 'h6 mb-1 text-break', info.gone ? (known.filename || CFX.t('expired')) : (info.filename || CFX.t('unnamed')));
        head.appendChild(title);
        head.appendChild(el('span', 'badge text-bg-' + (share.admin ? 'dark' : 'secondary') + ' flex-shrink-0', share.admin ? CFX.t('role_owner') : CFX.t('role_guest')));
        body.appendChild(head);

        const actions = el('div', 'd-flex flex-wrap gap-2 mt-3');
        const qrBox = el('div', 'mt-3 mx-auto d-none');
        qrBox.style.maxWidth = '200px';

        if (info.gone) {
            const parts = [CFX.t('expired')];
            if (typeof known.layers === 'number') parts.push(CFX.t('last_seen', String(known.layers)));
            body.appendChild(el('p', 'text-muted small mb-0', parts.join(' · ')));
            const rm = button('bi-x-circle', CFX.t('forget'));
            rm.addEventListener('click', function () { forget(share.id); onRemoved(col); });
            actions.appendChild(rm);
        } else {
            const meta = el('p', 'text-muted small mb-0');
            meta.appendChild(el('i', 'bi bi-people-fill'));
            meta.appendChild(doc.createTextNode(' ' + info.layers + ' ' + CFX.t('signatures') + ' · ' + expiryText(info.expires)));
            body.appendChild(meta);

            actions.appendChild(linkButton('bi-box-arrow-up-right', CFX.t('open'), '/signature/' + share.id + '#' + share.key, 'btn-primary'));
            const copy = button('bi-clipboard', CFX.t('copy'));
            copy.addEventListener('click', async function () {
                try { await root.navigator.clipboard.writeText(link); copy.lastChild.textContent = ' ' + CFX.t('copied'); } catch (e) { /* ignore */ }
            });
            actions.appendChild(copy);
            const copyMsg = button('bi-chat-left-text', CFX.t('copy_message'));
            copyMsg.addEventListener('click', async function () {
                try {
                    await root.navigator.clipboard.writeText(CFX.shareMessage(link, info.filename || ''));
                    copyMsg.lastChild.textContent = ' ' + CFX.t('copied');
                    setTimeout(function () { copyMsg.lastChild.textContent = ' ' + CFX.t('copy_message'); }, 1800);
                } catch (e) { /* ignore */ }
            });
            actions.appendChild(copyMsg);
            const wa = linkButton('bi-whatsapp', 'WhatsApp', CFX.waHref(link, info.filename || ''));
            wa.target = '_blank'; wa.rel = 'noopener';
            actions.appendChild(wa);
            actions.appendChild(linkButton('bi-envelope', CFX.t('send_email'), CFX.mailtoHref(link, info.filename || '')));
            actions.appendChild(linkButton('bi-chat-dots', CFX.t('send_sms'), CFX.smsHref(link, info.filename || '')));
            const qr = button('bi-qr-code', CFX.t('show_qr'));
            let shown = false;
            qr.addEventListener('click', async function () {
                shown = !shown;
                qrBox.classList.toggle('d-none', !shown);
                qr.lastChild.textContent = ' ' + CFX.t(shown ? 'hide_qr' : 'show_qr');
                if (shown && !qrBox.firstChild) { try { await CFX.renderQr(qrBox, link); } catch (e) { /* ignore */ } }
            });
            actions.appendChild(qr);

            if (share.admin) {
                const del = button('bi-trash', CFX.t('delete'), 'btn-outline-danger');
                del.addEventListener('click', async function () {
                    if (!root.confirm(CFX.t('confirm_delete'))) return;
                    del.disabled = true;
                    try {
                        const r = await fetch('/api/share/' + share.id, { method: 'DELETE', headers: { 'X-Admin-Key': share.admin } });
                        if (!r.ok && r.status !== 404) throw new Error('delete_failed');
                        forget(share.id);
                        onRemoved(col);
                    } catch (e) {
                        del.disabled = false;
                        root.alert(CFX.t('delete_failed'));
                    }
                });
                actions.appendChild(del);
            } else {
                const rm = button('bi-x-circle', CFX.t('forget'));
                rm.addEventListener('click', function () { forget(share.id); onRemoved(col); });
                actions.appendChild(rm);
            }
        }
        body.appendChild(actions);
        body.appendChild(qrBox);
        return col;
    }

    // Diagnostic des notifications : dernier événement enregistré par le serveur + bouton de test
    async function setupNotifyPanel() {
        const panel = doc.getElementById('notify-panel');
        if (!panel) return;
        let st;
        try {
            const r = await fetch('/api/notify/status', { cache: 'no-store' });
            if (!r.ok) return;
            st = await r.json();
        } catch (e) { return; }
        if (!st.available) return;
        panel.classList.remove('d-none');
        const last = doc.getElementById('notify-last');
        const describe = function (l) {
            if (!l) return CFX.t('notify_none_yet');
            const when = new Date(l.at * 1000).toLocaleString(doc.documentElement.lang || undefined, { dateStyle: 'short', timeStyle: 'medium' });
            const key = { sent: 'notify_out_sent', failed: 'notify_out_failed', 'no-config': 'notify_out_no_config', 'below-threshold': 'notify_out_below', 'test-sent': 'notify_out_test_sent', 'test-failed': 'notify_out_test_failed' }[l.outcome] || l.outcome;
            let txt = when + ' : ' + CFX.t(key);
            if (typeof l.total === 'number') txt += ' (' + l.total + ' ' + CFX.t('signatures') + ')';
            if (l.outcome === 'failed' || l.outcome === 'test-failed') txt += ' — HTTP ' + l.status + (l.detail ? ' ' + l.detail : '');
            return CFX.t('notify_last', txt);
        };
        last.textContent = describe(st.last);
        const btn = doc.getElementById('notify-test'), res = doc.getElementById('notify-result');
        btn.addEventListener('click', async function () {
            btn.disabled = true; res.textContent = CFX.t('notify_testing'); res.className = 'small ms-2 text-muted';
            try {
                const r = await fetch('/api/notify/test', { method: 'POST' });
                const j = await r.json();
                if (j.ok) { res.textContent = CFX.t('notify_ok'); res.className = 'small ms-2 text-success'; }
                else { res.textContent = CFX.t('notify_ko') + ' — HTTP ' + (j.status || '?') + (j.detail ? ' ' + j.detail : ''); res.className = 'small ms-2 text-danger'; }
                const s2 = await (await fetch('/api/notify/status', { cache: 'no-store' })).json();
                last.textContent = describe(s2.last);
            } catch (e) { res.textContent = CFX.t('notify_ko') + ' — ' + e.message; res.className = 'small ms-2 text-danger'; }
            btn.disabled = false;
        });
    }

    async function main() {
        setupNotifyPanel();
        const list = doc.getElementById('shares-list');
        const empty = doc.getElementById('shares-empty');
        const error = doc.getElementById('shares-error');
        const shares = storedShares().filter(function (s) { return s.key; });
        const updateEmpty = function () { empty.classList.toggle('d-none', list.children.length > 0); };
        const onRemoved = function (node) { node.remove(); updateEmpty(); };
        if (!shares.length) { updateEmpty(); return; }

        const rows = await Promise.all(shares.map(async function (s) {
            try { return { s, info: await readInfo(s) }; } catch (e) { return { s, error: true }; }
        }));
        // les plus récents (expiration la plus lointaine) en premier ; expirés à la fin
        rows.sort(function (a, b) { return ((b.info && b.info.expires) || 0) - ((a.info && a.info.expires) || 0); });
        rows.forEach(function (r) {
            if (r.error) { error.textContent = CFX.t('load_error'); error.classList.remove('d-none'); return; }
            list.appendChild(card(r.s, r.info, onRemoved));
        });
        updateEmpty();
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', main); else main();
})(window);
