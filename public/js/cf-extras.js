/*
 * Signature PDF sur Cloudflare — compléments d'interface (AGPL-3.0-or-later).
 *  - liens « Mes partages » et « Se déconnecter » (affichés selon l'état de connexion)
 *  - QR code, e-mail et SMS pour envoyer un lien de partage
 * Aucune donnée n'est envoyée à un tiers : le QR code est généré dans le navigateur.
 */
(function (root) {
    'use strict';

    const I18N = {
        fr: {
            nav_shares: 'Mes partages', nav_logout: 'Se déconnecter',
            send_email: 'Envoyer par e-mail', send_sms: 'Envoyer par SMS', show_qr: 'QR code', hide_qr: 'Masquer le QR code',
            qr_hint: "Le lien contient la clé de chiffrement : à n'envoyer qu'aux signataires.",
            mail_subject: 'Document à signer', mail_subject_named: 'À signer : %s',
            msg_named: "Bonjour,\n\nPeux-tu signer « {file} » en ligne ?\n{link}\n\nLe lien est personnel (il contient la clé de chiffrement) : merci de ne pas le transférer.",
            msg_plain: "Bonjour,\n\nPeux-tu signer ce document en ligne ?\n{link}\n\nLe lien est personnel (il contient la clé de chiffrement) : merci de ne pas le transférer.",
            message_label: 'Message à envoyer (modifiable)', copy_message: 'Copier le message', download_qr: 'Télécharger le QR code',
            share_intro: "Le PDF est chiffré dans votre navigateur avant d'être stocké.",
            perms_title: 'Les signataires peuvent :', perms_hint: "Restriction d'interface, pas une protection absolue : qui voit le document peut en faire une copie.",
            perm_dl: 'Télécharger le PDF', perm_sig: 'Signature', perm_ini: 'Paraphe', perm_stamp: 'Tampon', perm_text: 'Texte', perm_strike: 'Rayer', perm_check: 'Case à cocher', perm_create: 'Créer un élément',
            notify_diag_title: 'Notifications', notify_test: 'Envoyer une notification de test', notify_testing: 'Envoi…', notify_none_yet: "Aucun envoi enregistré pour l'instant.",
            notify_out_sent: 'envoyée', notify_out_failed: 'échec', notify_out_no_config: "aucune notification n'était demandée pour ce partage", notify_out_below: 'seuil pas encore atteint', notify_out_test_sent: 'test envoyé', notify_out_test_failed: 'test en échec', notify_last: 'Dernier événement : %s', notify_ok: 'Notification envoyée : vérifie ton appareil.', notify_ko: 'Échec',
            notify_title: 'Me prévenir (Gotify)', notify_each: 'À chaque signature', notify_final: 'Message final quand on atteint', notify_count_suffix: 'signature(s)',
            notify_open: 'Quand le lien est ouvert pour la première fois', notify_expire: "S'il expire dans 24 h sans signature", notify_ev_open: 'lien ouvert', notify_ev_expire: 'expiration proche',
            change_duration: 'Changer la durée', apply: 'Appliquer', duration_from_now: 'Expire dans', dur_3600: '1 heure', dur_86400: '1 jour', dur_604800: '1 semaine', dur_2592000: '1 mois', dur_15552000: '6 mois', dur_31536000: '1 an', duration_failed: 'Modification impossible, réessayez.',
            duplicate: 'Dupliquer', duplicate_hint: 'Nouveau lien vers le même document, sans les signatures', duplicate_failed: 'Duplication impossible, réessayez.',
            shares_title: 'Mes partages',
            shares_help: "Les documents que vous avez partagés (ou ouverts) depuis ce navigateur. Cette liste est propre à cet appareil : elle n'est pas stockée sur le serveur.",
            shares_empty: "Aucun partage pour l'instant. Ouvrez un PDF dans « Signer » puis utilisez « Partager pour signer à plusieurs ».",
            role_owner: 'Créé ici', role_guest: 'Reçu pour signature',
            signatures: 'signature(s)', expires_on: 'Expire le %s', expires_in_days: '(dans %s jours)', expires_today: "(aujourd'hui)",
            open: 'Ouvrir', copy: 'Copier le lien', copied: 'Copié !', delete: 'Supprimer', forget: 'Retirer de la liste',
            expired: 'Expiré ou supprimé', unnamed: 'Document',
            confirm_delete: 'Supprimer ce partage pour tout le monde ? Le PDF et les signatures seront effacés du serveur.',
            delete_failed: 'Suppression impossible, réessayez.', load_error: 'Impossible de contacter le serveur.',
            link_hint: 'Lien de partage',
            expired_on: 'Expiré le %s', last_seen: 'dernier état connu : %s signature(s)',
        },
        en: {
            nav_shares: 'My shares', nav_logout: 'Log out',
            send_email: 'Send by e-mail', send_sms: 'Send by SMS', show_qr: 'QR code', hide_qr: 'Hide QR code',
            qr_hint: 'The link contains the encryption key: only send it to the signers.',
            mail_subject: 'Document to sign', mail_subject_named: 'To sign: %s',
            msg_named: 'Hello,\n\nCould you sign "{file}" online?\n{link}\n\nThe link is personal (it contains the encryption key): please do not forward it.',
            msg_plain: 'Hello,\n\nCould you sign this document online?\n{link}\n\nThe link is personal (it contains the encryption key): please do not forward it.',
            message_label: 'Message to send (editable)', copy_message: 'Copy message', download_qr: 'Download the QR code',
            share_intro: 'The PDF is encrypted in your browser before it is stored.',
            perms_title: 'Signers can:', perms_hint: 'Interface restriction, not absolute protection: anyone who can see the document can copy it.',
            perm_dl: 'Download the PDF', perm_sig: 'Signature', perm_ini: 'Initials', perm_stamp: 'Stamp', perm_text: 'Text', perm_strike: 'Strikethrough', perm_check: 'Check box', perm_create: 'Create an element',
            notify_diag_title: 'Notifications', notify_test: 'Send a test notification', notify_testing: 'Sending…', notify_none_yet: 'No delivery recorded yet.',
            notify_out_sent: 'sent', notify_out_failed: 'failed', notify_out_no_config: 'no notification was requested for this share', notify_out_below: 'threshold not reached yet', notify_out_test_sent: 'test sent', notify_out_test_failed: 'test failed', notify_last: 'Last event: %s', notify_ok: 'Notification sent: check your device.', notify_ko: 'Failed',
            notify_title: 'Notify me (Gotify)', notify_each: 'On every signature', notify_final: 'Final message when reaching', notify_count_suffix: 'signature(s)',
            notify_open: 'When the link is opened for the first time', notify_expire: 'If it expires within 24 h with no signature', notify_ev_open: 'link opened', notify_ev_expire: 'expiring soon',
            change_duration: 'Change duration', apply: 'Apply', duration_from_now: 'Expires in', dur_3600: '1 hour', dur_86400: '1 day', dur_604800: '1 week', dur_2592000: '1 month', dur_15552000: '6 months', dur_31536000: '1 year', duration_failed: 'Unable to change, try again.',
            duplicate: 'Duplicate', duplicate_hint: 'New link to the same document, without the signatures', duplicate_failed: 'Unable to duplicate, try again.',
            shares_title: 'My shares',
            shares_help: 'Documents you shared (or opened) from this browser. This list is specific to this device: it is not stored on the server.',
            shares_empty: 'No shares yet. Open a PDF in "Sign", then use "Share to sign with multiple people".',
            role_owner: 'Created here', role_guest: 'Received to sign',
            signatures: 'signature(s)', expires_on: 'Expires on %s', expires_in_days: '(in %s days)', expires_today: '(today)',
            open: 'Open', copy: 'Copy link', copied: 'Copied!', delete: 'Delete', forget: 'Remove from list',
            expired: 'Expired or deleted', unnamed: 'Document',
            confirm_delete: 'Delete this share for everyone? The PDF and the signatures will be erased from the server.',
            delete_failed: 'Unable to delete, please try again.', load_error: 'Unable to reach the server.',
            link_hint: 'Sharing link',
            expired_on: 'Expired on %s', last_seen: 'last known state: %s signature(s)',
        },
    };
    function lang() {
        const l = ((root.document && root.document.documentElement.lang) || 'en').toLowerCase().split('-')[0];
        return I18N[l] ? l : 'en';
    }
    function t(k, arg) {
        const s = (I18N[lang()][k] !== undefined ? I18N[lang()][k] : I18N.en[k]) || k;
        return arg === undefined ? s : s.replace('%s', arg);
    }
    function applyI18n(scope) {
        (scope || root.document).querySelectorAll('[data-cfx]').forEach(function (el) { el.textContent = t(el.getAttribute('data-cfx')); });
        (scope || root.document).querySelectorAll('[data-cfx-title]').forEach(function (el) { el.setAttribute('title', t(el.getAttribute('data-cfx-title'))); });
    }

    // ---------------------------------------------------------------- QR code (bibliothèque chargée à la demande)
    let qrLoading = null;
    function loadQr() {
        if (root.qrcode) return Promise.resolve();
        if (!qrLoading) {
            qrLoading = new Promise(function (resolve, reject) {
                const s = root.document.createElement('script');
                s.src = '/vendor/qrcode.js?1.4.4';
                s.onload = resolve;
                s.onerror = reject;
                root.document.head.appendChild(s);
            });
        }
        return qrLoading;
    }
    /** Dessine le QR code de `text` dans l'élément `el` (SVG généré localement). */
    async function renderQr(el, text) {
        await loadQr();
        const qr = root.qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        const svg = el.querySelector('svg');
        if (svg) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR code'); svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.background = '#fff'; }
    }

    // ---------------------------------------------------------------- message, e-mail, SMS, WhatsApp
    function shareMessage(link, filename) {
        const tpl = filename ? t('msg_named') : t('msg_plain');
        return tpl.replace('{file}', filename || '').replace('{link}', link);
    }
    function mailtoHref(link, filename, body) {
        const subject = filename ? t('mail_subject_named', filename) : t('mail_subject');
        return 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body || shareMessage(link, filename));
    }
    function smsHref(link, filename, body) {
        return 'sms:?&body=' + encodeURIComponent(body || shareMessage(link, filename));
    }
    function waHref(link, filename, body) {
        return 'https://wa.me/?text=' + encodeURIComponent(body || shareMessage(link, filename));
    }

    /** QR code en PNG (grande taille, marge blanche) généré localement. */
    async function qrPngBlob(text) {
        await loadQr();
        const qr = root.qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        const n = qr.getModuleCount(), margin = 4;
        const scale = Math.max(4, Math.floor(1024 / (n + 2 * margin)));
        const size = (n + 2 * margin) * scale;
        const canvas = root.document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#000';
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
            if (qr.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
        }
        return new Promise(function (resolve, reject) { canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('png')); }, 'image/png'); });
    }
    async function downloadQr(link, filename) {
        const blob = await qrPngBlob(link);
        const slug = (filename || 'signature').replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'signature';
        const a = root.document.createElement('a');
        a.href = root.URL.createObjectURL(blob);
        a.download = 'qr-' + slug + '.png';
        root.document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { root.URL.revokeObjectURL(a.href); }, 2000);
    }

    // ---------------------------------------------------------------- liens de navigation selon l'état de connexion
    async function setupNav() {
        const shares = root.document.getElementById('nav-shares');
        const logout = root.document.getElementById('nav-logout');
        if (!shares && !logout) return;
        let cfg = { gated: false, authed: false };
        try {
            const r = await fetch('/api/config', { cache: 'no-store' });
            if (r.ok) cfg = await r.json();
        } catch (e) { /* hors ligne : on laisse les liens masqués */ return; }
        const authedOrOpen = !cfg.gated || cfg.authed;
        if (shares && authedOrOpen) shares.classList.remove('d-none');
        if (logout && cfg.gated && cfg.authed) logout.classList.remove('d-none');
    }

    // ---------------------------------------------------------------- fenêtre de partage (page /signature/<id>)
    function currentShare() {
        const m = /^\/signature\/([a-z0-9]{10,64})\/?$/.exec(root.location.pathname);
        if (!m) return null;
        let key = (root.location.hash || '').replace(/^#/, '');
        if (!key) { try { key = root.localStorage.getItem('cfkey.' + m[1]) || ''; } catch (e) { /* ignore */ } }
        return { id: m[1], link: root.location.origin + '/signature/' + m[1] + (key ? '#' + key : '') };
    }
    function knownFilename(id) {
        try { if (typeof cfShared !== 'undefined' && cfShared && cfShared.filename) return cfShared.filename; } catch (e) { /* ignore */ }
        try { const i = JSON.parse(root.localStorage.getItem('cfinfo.' + id) || 'null'); if (i && i.filename) return i.filename; } catch (e) { /* ignore */ }
        return '';
    }
    function setupShareModal() {
        const modal = root.document.getElementById('modal-share-informations');
        const qrBox = root.document.getElementById('share-qr');
        if (!modal || !qrBox) return;
        const $ = function (id) { return root.document.getElementById(id); };
        let cur = null, filename = '';
        const updateLinks = function () {
            if (!cur) return;
            const body = $('share-message').value;
            $('share-mail').href = mailtoHref(cur.link, filename, body);
            $('share-sms').href = smsHref(cur.link, filename, body);
            $('share-wa').href = waHref(cur.link, filename, body);
        };
        const refresh = function () {
            cur = currentShare();
            if (!cur) return;
            filename = knownFilename(cur.id);
            $('share-message').value = shareMessage(cur.link, filename);
            updateLinks();
            renderQr(qrBox, cur.link).catch(function () { qrBox.textContent = ''; });
        };
        $('share-message').addEventListener('input', updateLinks);
        $('share-copy-msg').addEventListener('click', async function () {
            const span = this.querySelector('span');
            try { await root.navigator.clipboard.writeText($('share-message').value); span.textContent = t('copied'); } catch (e) { $('share-message').select(); }
            setTimeout(function () { span.textContent = t('copy_message'); }, 1800);
        });
        $('share-qr-dl').addEventListener('click', function () { if (cur) downloadQr(cur.link, filename).catch(function () { /* ignore */ }); });
        modal.addEventListener('show.bs.modal', refresh);
    }

    // Option de notification Gotify : proposée seulement si le Worker a GOTIFY_URL et GOTIFY_TOKEN
    async function setupNotifyOption() {
        const block = root.document.getElementById('share_notify_block');
        if (!block) return;
        try {
            const r = await fetch('/api/config', { cache: 'no-store' });
            if (r.ok && (await r.json()).notify) {
                block.classList.remove('d-none');
            }
        } catch (e) { /* hors ligne : option masquée */ }
    }

    function init() {
        applyI18n();
        setupNav();
        setupShareModal();
        setupNotifyOption();
    }
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init); else init();

    root.CFX = { t, applyI18n, renderQr, qrPngBlob, shareMessage, mailtoHref, smsHref, waHref };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.CFX;
})(typeof window !== 'undefined' ? window : globalThis);
