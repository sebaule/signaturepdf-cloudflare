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
            qr_hint: "Le lien contient la clé de chiffrement : ne l'envoyez qu'aux personnes qui doivent signer.",
            mail_subject: 'Document à signer', mail_subject_named: 'À signer : %s',
            mail_body: "Bonjour,\n\nPeux-tu signer ce document en ligne ?\n%s\n\nCe lien est personnel : il contient la clé de chiffrement du document, ne le transfère pas.",
            sms_body: 'Document à signer : %s',
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
            nodl_label: 'Les signataires ne peuvent pas télécharger le PDF (réservé à moi)',
            nodl_hint: "Restriction d'interface : quelqu'un qui voit le document peut toujours en faire une copie. Le téléchargement reste disponible pour vous (navigateur de création ou session connectée).",
            expired_on: 'Expiré le %s', last_seen: 'dernier état connu : %s signature(s)',
        },
        en: {
            nav_shares: 'My shares', nav_logout: 'Log out',
            send_email: 'Send by e-mail', send_sms: 'Send by SMS', show_qr: 'QR code', hide_qr: 'Hide QR code',
            qr_hint: 'The link contains the encryption key: only send it to the people who need to sign.',
            mail_subject: 'Document to sign', mail_subject_named: 'To sign: %s',
            mail_body: 'Hello,\n\nCould you sign this document online?\n%s\n\nThis link is personal: it contains the document encryption key, please do not forward it.',
            sms_body: 'Document to sign: %s',
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
            nodl_label: 'Signers cannot download the PDF (reserved for me)',
            nodl_hint: 'Interface restriction: anyone who can see the document can still copy it. Download stays available to you (creating browser or logged-in session).',
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

    // ---------------------------------------------------------------- e-mail et SMS
    function mailtoHref(link, filename) {
        const subject = filename ? t('mail_subject_named', filename) : t('mail_subject');
        return 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(t('mail_body', link));
    }
    function smsHref(link) {
        return 'sms:?&body=' + encodeURIComponent(t('sms_body', link));
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
    function setupShareModal() {
        const modal = root.document.getElementById('modal-share-informations');
        const qrBox = root.document.getElementById('share-qr');
        if (!modal || !qrBox) return;
        const refresh = function () {
            const cur = currentShare();
            if (!cur) return;
            const mail = root.document.getElementById('share-mail');
            const sms = root.document.getElementById('share-sms');
            if (mail) mail.href = mailtoHref(cur.link, '');
            if (sms) sms.href = smsHref(cur.link);
            renderQr(qrBox, cur.link).catch(function () { qrBox.textContent = ''; });
        };
        modal.addEventListener('show.bs.modal', refresh);
    }

    function init() {
        applyI18n();
        setupNav();
        setupShareModal();
    }
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init); else init();

    root.CFX = { t, applyI18n, renderQr, mailtoHref, smsHref };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.CFX;
})(typeof window !== 'undefined' ? window : globalThis);
