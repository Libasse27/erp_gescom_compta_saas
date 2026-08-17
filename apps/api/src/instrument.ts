import * as Sentry from "@sentry/nestjs";

// P-08 (docs/audit/PRODUCTION-READINESS.md) : doit être importé en tout
// premier dans main.ts, avant NestFactory et tout le reste (recommandation
// officielle @sentry/nestjs — nécessaire à l'instrumentation automatique).
// Désactivé par défaut : Sentry.init() n'est appelé que si SENTRY_DSN est
// renseigné, voir docs/deployment/MONITORING.md pour la marche à suivre
// (création d'un compte Sentry, obtention du DSN).
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
  });
}
