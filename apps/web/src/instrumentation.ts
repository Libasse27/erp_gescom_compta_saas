import * as Sentry from "@sentry/nextjs";

// P-08 (docs/audit/PRODUCTION-READINESS.md) : hook officiel Next.js (App
// Router), appelé une fois par runtime au démarrage du serveur — désactivé
// par défaut, Sentry.init() n'est appelé que si SENTRY_DSN est renseigné.
// Voir docs/deployment/MONITORING.md pour la marche à suivre. Volontairement
// limité au runtime Node.js (pas de tracking client-side navigateur ici :
// ça nécessiterait d'inliner NEXT_PUBLIC_SENTRY_DSN au build, comme
// NEXT_PUBLIC_API_URL, et d'uploader des source maps — hors périmètre du
// minimum demandé par l'audit).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? "development",
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
