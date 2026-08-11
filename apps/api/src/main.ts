import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { RequestMethod } from "@nestjs/common";
import { AppModule } from "./app.module";
import { env } from "./config/env";

async function bootstrap() {
  // rawBody: true expose req.rawBody (Buffer exact reçu sur le fil) sans
  // changer le parsing JSON habituel pour le reste de l'API — nécessaire
  // pour vérifier une signature de webhook, qui porte sur les octets bruts,
  // jamais sur le JSON re-sérialisé (Phase 5, docs/adr/0010-...).
  const app = await NestFactory.create(AppModule, { rawBody: true });

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
    exclude: [{ path: "webhooks/payments/:provider", method: RequestMethod.ALL }],
  });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
