// Reverse proxy minimal (Cloudflare Pages, mode « advanced ») : transmet TOUTE requête, telle quelle, au Worker
// de l'application via une liaison de service (APP). Le nom de domaine reste celui de la requête d'origine,
// donc l'application et ses liens de partage utilisent automatiquement ce domaine.
// Licence : AGPL-3.0-or-later (comme le reste du projet).
export default {
  async fetch(request, env) {
    if (!env.APP) {
      return new Response('Liaison de service « APP » manquante (voir proxy/README.md)', { status: 500 });
    }
    return env.APP.fetch(request);
  },
};
