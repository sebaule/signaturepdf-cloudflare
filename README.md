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

# 4) (recommandé) mot de passe d'accès au site : sans lui, tout le monde peut utiliser le site
npx wrangler secret put SHARE_PASSWORD

# 5) Lien « code source » du pied de page = ton dépôt GitHub (obligation de la licence AGPL)
npm run set-source -- https://github.com/TON-COMPTE/TON-DEPOT

# 6) Mise en ligne
npm run deploy
```

Le site est alors disponible sur `https://signaturepdf.<ton-sous-domaine>.workers.dev`.
Pour ton propre domaine : *Workers & Pages → signaturepdf → Settings → Domains & Routes → Add → Custom domain*
(le domaine doit être géré par Cloudflare), par exemple `signature.ton-domaine.fr`.

### Accès protégé par mot de passe

Quand le secret `SHARE_PASSWORD` est défini (dans Cloudflare : *Workers & Pages → ton Worker → Settings → Variables and Secrets*, **zone Runtime**, type **Secret**) :

| | Mot de passe demandé ? |
|---|---|
| Pages Signer / Organiser / Métadonnées / Mes partages | **oui** (page `/login`, session de 30 jours, lien « Se déconnecter » dans le menu) |
| Création d'un partage | **oui** (la session suffit) |
| Lien de partage `/signature/<id>#<clé>` : ouverture, signature, téléchargement | non : il faut le lien complet (identifiant + clé de chiffrement) |
| Suppression d'un partage | clé d'administration, conservée dans le navigateur du créateur |
| Fichiers statiques (scripts, styles) | non (c'est du code public) |

Sans `SHARE_PASSWORD`, le site est ouvert à tous. Vérification : `/api/config` doit répondre `"gated":true`.

### Limitation des essais de mot de passe

- **Dans le Worker** : le binding `ratelimits` (`LOGIN_LIMITER` dans `wrangler.jsonc`) limite à 5 essais par minute et par adresse IP sur `/login` et sur la création de partage par mot de passe (réponse 429).
- **En plus, côté Cloudflare, uniquement avec ton propre nom de domaine** (les règles WAF ne s'appliquent pas à une adresse `workers.dev`) : *Sécurité → WAF → Règles de limitation de débit* → URI path = `/login` (méthode POST), 10 requêtes / 1 min par IP → Bloquer. Cette règle s'applique avant même que le Worker ne s'exécute. Sur `workers.dev`, la limitation du Worker (ci-dessus) est la protection en place.
- Choisis un mot de passe long (≥ 16 caractères) : il ne se change que dans Cloudflare.

### Sécurité : à faire en plus (gratuit)

1. **`SHARE_PASSWORD`** (étape 4) : sans lui, n'importe qui connaissant l'URL peut utiliser le site et déposer des PDF chez toi (jusqu'aux limites ci-dessous).
2. Garde ton dépôt **public** si tu modifies le code (AGPL) et ne commite jamais de secret : `SHARE_PASSWORD` vit dans Cloudflare, pas dans les fichiers.

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

## Fonctions pratiques

- **Mes partages** (`/shares`) : liste des documents partagés ou ouverts depuis ce navigateur (nom déchiffré sur place, nombre de signatures, expiration), avec copie du lien, e-mail, SMS, QR code et suppression. La liste est propre à l'appareil : les clés ne quittent jamais le navigateur.
- **QR code, e-mail, SMS** dans la fenêtre de partage : le QR code est généré dans le navigateur (bibliothèque `qrcode-generator`, MIT, livrée dans `site/public/vendor`).
- **Se déconnecter** : dans le menu, visible quand le site est protégé.
- **Droits des signataires** : à la création d'un partage, cases à cocher (télécharger le PDF, signature, paraphe, tampon, texte, rayer, case à cocher, créer un élément). Ce qui est décoché est masqué pour les signataires ; le navigateur qui a créé le partage et une session connectée au site gardent tout. Les droits sont stockés dans les métadonnées chiffrées. C'est une restriction d'interface, pas une protection cryptographique : quiconque peut lire un document peut en faire une copie.
- **Message prêt à envoyer** : texte modifiable, copie en un clic, boutons WhatsApp, e-mail et SMS, QR code téléchargeable en PNG (généré dans le navigateur).
- **Notifications Gotify (facultatif)** : au choix à la création du partage : à chaque signature, un message final quand N signatures sont reçues, les deux ensemble (à la N-ième signature, seul le message final part), ou aucune. L'option n'apparaît que si deux secrets sont définis sur le Worker (Settings → Variables and Secrets, type Secret) : `GOTIFY_URL` (adresse du serveur Gotify en https, sans `/message`) et `GOTIFY_TOKEN` (jeton d'application). Le message ne contient que le nombre de signatures (jamais le nom du fichier, qui est chiffré). Le serveur Gotify doit être joignable depuis Internet. Le réglage est conservé dans KV (clé `n:<id>`) et supprimé avec le partage.
- **Notifications d'événements (facultatif)** : en plus, une notification au premier accès d'un invité au lien (le propriétaire ne déclenche rien) et une alerte, envoyée une seule fois, quand un partage sans aucune signature approche de son expiration (un quart de la durée choisie, entre 1 h et 7 jours avant : 1 mois → 7 jours, 1 semaine → 42 h, 1 jour → 6 h ; indisponible pour 1 heure ; vérifiée par le cron horaire, 2 partages par passage). Changer la durée d'un partage ré-arme l'alerte.
- **Durée et duplication (Mes partages, propriétaire)** : « Changer la durée » fixe une nouvelle expiration à partir de maintenant (1 h à 1 an) ; « Dupliquer » crée un nouveau lien vers le même document chiffré (même clé, sans les signatures, mêmes notifications), pratique pour le renvoyer à d'autres personnes.

## Développer en local

```bash
npm install
npm run db:migrate:local
npm run dev            # http://127.0.0.1:8787
npm test               # chiffrement + placement des signatures, puis tests d'intégration du Worker (lance wrangler dev tout seul)
```

Les tests tournent aussi sur GitHub à chaque envoi (`.github/workflows/tests.yml`) : génération des pages dans les 15 langues, tests de `cf-share.js` et du Worker (verrouillage, cycle de partage, limitation des essais).

Les pages HTML (15 langues × 6 pages) sont générées à partir des gabarits PHP d'origine (`site/templates`) par `npm run build`
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
