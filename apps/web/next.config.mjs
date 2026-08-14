/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bundle serveur minimal auto-suffisant (Phase 10.1) — nécessaire à
  // l'image Docker de production, voir apps/web/Dockerfile. Activé
  // uniquement dans ce contexte (DOCKER_BUILD=true, posé par le Dockerfile) :
  // le mode "standalone" fait créer des liens symboliques par Next.js pour
  // le tracing des dépendances, ce qui échoue sur Windows sans mode
  // développeur/droits élevés (EPERM) — testé en vérifiant cette phase,
  // `pnpm build` cassait sur ce poste alors que le build Docker (Linux)
  // fonctionnait.
  ...(process.env.DOCKER_BUILD === "true" ? { output: "standalone" } : {}),
};

export default nextConfig;
