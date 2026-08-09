import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  // rawBody: true expose req.rawBody (Buffer exact reçu sur le fil) sans
  // changer le parsing JSON habituel pour le reste de l'API — nécessaire
  // pour vérifier une signature de webhook, qui porte sur les octets bruts,
  // jamais sur le JSON re-sérialisé (Phase 5, docs/adr/0010-...).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
