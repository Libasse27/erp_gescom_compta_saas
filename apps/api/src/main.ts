import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { Logger, RequestMethod } from "@nestjs/common";
import { AppModule } from "./app.module";
import { env } from "./config/env";
import { StructuredLoggerService } from "./common/logging/structured-logger.service";
import { MAIL_SENDER, ConsoleMailSender } from "./notifications/mail-sender";

async function bootstrap() {
  // rawBody: true expose req.rawBody (Buffer exact reçu sur le fil) sans
  // changer le parsing JSON habituel pour le reste de l'API — nécessaire
  // pour vérifier une signature de webhook, qui porte sur les octets bruts,
  // jamais sur le JSON re-sérialisé (Phase 5, docs/adr/0010-...).
  // logger : remplace le logger console par défaut de Nest dès le
  // bootstrap (Phase 10.5) — tout `new Logger(context)` de l'application,
  // y compris les messages internes de démarrage Nest, passe par lui.
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: new StructuredLoggerService() });

  // Corrige SEC-04 (docs/audit/SECURITY-AUDIT.md) : aucune intégration SMTP
  // réelle n'existe encore (Phase 24 du prompt maître) — ConsoleMailSender
  // reste donc branché en production tant que ce chantier n'est pas fait.
  // Avertissement fort plutôt qu'un refus de démarrage strict : le
  // déploiement documenté (scripts/prod-post-deploy.sh) ne configure encore
  // aucun expéditeur réel, un fail-closed casserait le seul chemin de
  // déploiement existant sans offrir d'alternative.
  if (process.env.NODE_ENV === "production" && app.get(MAIL_SENDER) instanceof ConsoleMailSender) {
    new Logger("Bootstrap").warn(
      "Aucun expéditeur d'email réel configuré (MAIL_SENDER = ConsoleMailSender) : " +
        "la réinitialisation de mot de passe, la vérification d'email et les invitations " +
        "n'envoient aucun courriel réel en production.",
    );
  }

  app.use(helmet());
  // Liste blanche stricte, jamais "*" (CLAUDE.md §6). credentials:true
  // n'est pas nécessaire ici : apps/web envoie l'accessToken via en-tête
  // Authorization, pas de cookie envoyé à l'API elle-même (le cookie
  // httpOnly du refresh token reste côté Next.js, docs/adr/0011-...).
  app.enableCors({ origin: env.corsAllowedOrigins() });

  // docs/adr/0007-... : un client mobile/desktop distribué ne peut pas être
  // mis à jour de façon synchrone avec l'API, d'où le préfixe /v1. Les
  // webhooks de paiement en sont exclus : leur URL est enregistrée à la main
  // dans les tableaux de bord des fournisseurs (Wave, Orange Money...) et
  // doit rester stable indépendamment du versionnage interne.
  app.setGlobalPrefix("v1", {
    exclude: [
      { path: "webhooks/payments/:provider", method: RequestMethod.ALL },
      // Une sonde d'infra (healthcheck Docker, load balancer) ne doit pas
      // dépendre du versionnage interne de l'API (Phase 10.5). /health/live
      // et /health/ready (P-06) suivent la même règle que l'alias /health.
      { path: "health", method: RequestMethod.GET },
      { path: "health/live", method: RequestMethod.GET },
      { path: "health/ready", method: RequestMethod.GET },
    ],
  });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
