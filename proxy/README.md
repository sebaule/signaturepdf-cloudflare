# Reverse proxy pour un domaine hébergé hors Cloudflare

Un Worker ne peut pas servir un domaine dont le DNS n'est pas chez Cloudflare, mais **Cloudflare Pages le peut pour un
sous-domaine** (simple enregistrement CNAME chez le fournisseur DNS). Ce petit projet Pages ne fait que transmettre chaque
requête au Worker de l'application par liaison de service : l'application ne change pas, son adresse devient `signature.exemple.fr`,
et les liens de partage utilisent automatiquement ce domaine.

## Mise en place (interface Cloudflare, sans code)

1. **Workers et Pages → Create → onglet Pages → Connect to Git** → dépôt `signaturepdf-cloudflare`.
   - Nom du projet : `signature-proxy`
   - Root directory (répertoire racine) : `proxy`
   - Build command : *(vide)* — Build output directory : `.`
2. Une fois déployé : **signature-proxy → Settings → Bindings (ou Functions) → Add → Service binding**
   (si la liaison n'apparaît pas déjà d'après `wrangler.jsonc`) : variable `APP`, service `signaturepdf-cloudflare` → Save, puis redéployer.
3. **signature-proxy → Custom domains → Set up a custom domain** → `signature.exemple.fr`. Cloudflare indique la cible du CNAME
   (`signature-proxy.pages.dev`).
4. Chez le fournisseur DNS (OVH : *Zone DNS → Ajouter une entrée → CNAME*) : sous-domaine `signature`, cible `signature-proxy.pages.dev.`
5. Attendre quelques minutes (certificat HTTPS automatique), puis ouvrir `https://signature.exemple.fr`.

Ordre important : associer le domaine dans Pages **avant** de créer le CNAME, sinon erreur 522.
