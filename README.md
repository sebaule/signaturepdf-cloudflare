# Signature PDF sur Cloudflare (gratuit, sans serveur)

Portage de [Signature PDF](https://github.com/24eme/signaturepdf) (24eme, AGPL-3.0) sur **Cloudflare Workers + D1 + KV**,
avec **signature collaborative chiffrée de bout en bout**. Aucun serveur à gérer, aucune carte bancaire demandée.

Fonctionne : signer un PDF (signature dessinée, tapée ou importée, paraphe, tampon, texte, case à cocher, zone masquée, filigrane),
**partager un lien pour que plusieurs personnes signent le même PDF**, organiser les pages, éditer les métadonnées.

## Comment ça marche

```
Navigateur ──(PDF chiffré AES-256-GCM)──▶ Worker ──▶ KV (blobs chiffrés) + D1 (index, expiration)
     ▲                                       │
     └── la clé est dans l'URL après le #, jamais envoyée au serveur
```

- Le PDF et chaque signature sont **chiffrés dans le navigateur** avant l'envoi. Cloudflare ne stocke que des octets illisibles.
- Le lien de partage ressemble à `https://signature.exemple.fr/signature/<id>#<clé>`. Qui a le lien complet peut lire et signer. Sans la partie `#...`, le document est inexploitable.
- La fusion PDF + signatures (et la mise « à plat ») se fait **dans le navigateur** avec pdf-lib / pdf.js. C'est ce qui permet de rester dans le plan gratuit (10 ms de CPU par requête).
- Les documents expirent (1 h à 1 an, au choix de celui qui partage, prolongé à chaque nouvelle signature) et sont purgés toutes les heures.

## Déploiement (≈ 10 minutes)

Prérequis : un compte Cloudflare gratuit et Node.js 20+.

```bash
npm install
npx wrangler login

# 1) Base D1 (index des partages) → copie le database_id affiché dans wrangler.jsonc
npx wrangler d1 create signaturepdf

# 2) Stockage KV (blobs chiffrés) → copie l'id affiché dans wrangler.jsonc
npx wrangler kv namespace create BLOBS

# 3) Création des tables
npm run db:migrate

# 4) (recommandé) mot de passe pour CRÉER un partage : les signataires n'en ont pas besoin
npx wrangler secret put SHARE_PASSWORD

# 5) Lien « code source » du pied de page = ton dépôt GitHub (obligation de la licence AGPL)
npm run set-source -- https://github.com/TON-COMPTE/TON-DEPOT

# 6) Mise en ligne
npm run deploy
```

Le site est alors disponible sur `https://signaturepdf.<ton-sous-domaine>.workers.dev`.
Pour ton propre domaine : *Workers & Pages → signaturepdf → Settings → Domains & Routes → Add → Custom domain*
(le domaine doit être géré par Cloudflare), par exemple `signature.ton-domaine.fr`.

### Sécurité : à faire en plus (gratuit)

1. **`SHARE_PASSWORD`** (étape 4) : sans lui, n'importe qui connaissant l'URL peut déposer des PDF chez toi (jusqu'aux limites ci-dessous).
2. **Règle de limitation de débit** : *Sécurité → WAF → Règles de limitation de débit* → URI path = `/api/share`, méthode POST, 5 requêtes / 10 s par IP → Bloquer.
3. Garde ton dépôt **public** si tu modifies le code (AGPL) et ne commite jamais de secret : `SHARE_PASSWORD` vit dans Cloudflare, pas dans les fichiers.

### Limites du plan gratuit (largement suffisantes pour un usage perso / associatif)

| Ressource | Limite gratuite | Dans ce projet |
|---|---|---|
| Requêtes Worker | 100 000 / jour | un lien ouvert interroge le serveur toutes les 30 s (onglet visible seulement) |
| KV | 1 Go, 1 000 écritures / jour | 1 écriture par partage + 1 par signature |
| D1 | 5 Go, 100 000 écritures / jour | quelques écritures par action |
| Taille d'un PDF partagé | — | 20 Mo (`MAX_BYTES`) |
| Signatures par document | — | 30 (`MAX_LAYERS`) |
| Documents partagés actifs | — | 300 (`MAX_SHARES`), 800 Mo au total (`TOTAL_BYTES`) |

Ajustables dans `wrangler.jsonc` (`vars`).

## Développer en local

```bash
npm install
npm run db:migrate:local
npm run dev            # http://127.0.0.1:8787
npm test               # tests unitaires (chiffrement, fusion de calques avec rotation de page)
BASE=http://127.0.0.1:8787 npm test   # + aller-retour complet avec le Worker (ajoute PW=... si SHARE_PASSWORD est défini)
```

Les pages HTML (15 langues × 5 pages) sont générées à partir des gabarits PHP d'origine (`site/templates`) par `npm run build`
(nécessite `php-cli`, uniquement pour ce build). Le dossier `public/` généré est versionné : **tu n'as pas besoin de PHP pour déployer**.

## Différences avec Signature PDF d'origine

| | Original (PHP) | Cette version (Cloudflare) |
|---|---|---|
| Chiffrement des partages | gpg côté serveur (le serveur voit la clé) | AES-256-GCM dans le navigateur (le serveur ne voit jamais la clé) |
| Assemblage du PDF signé | pdftk + rsvg-convert sur le serveur | pdf-lib dans le navigateur |
| Signatures dans le PDF | vectorielles | **images PNG haute définition** (~270 dpi) |
| « Image → vecteur » | potrace | vectorisation simplifiée dans le navigateur |
| Mise à plat (zones masquées, filigrane) | ImageMagick | rasterisation pdf.js à 200 dpi dans le navigateur (le texte masqué est réellement supprimé) |
| Compression PDF, OCR, signature par certificat du serveur | oui | **retirés** (nécessitent des programmes serveur) |
| Limite de taille | configurable PHP | 20 Mo par PDF partagé (limite KV) |

Les signatures apposées sont des **signatures manuscrites numérisées** (comme l'outil d'origine), pas des signatures électroniques qualifiées.

## Licence et sources

Projet dérivé de [24eme/signaturepdf](https://github.com/24eme/signaturepdf) (commit `9e2811a`), sous licence **AGPL-3.0** :
voir `LICENSE` et `NOTICE`. Si tu publies ta version en ligne, tu dois mettre ses sources à disposition des utilisateurs
(pied de page : `npm run set-source`). Les bibliothèques JavaScript fournies dans `public/vendor/` (pdf.js, pdf-lib, fabric.js, Bootstrap…)
gardent leurs licences d'origine.
