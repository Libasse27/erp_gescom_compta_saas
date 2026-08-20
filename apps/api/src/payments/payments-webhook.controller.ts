import { BadRequestException, Controller, HttpCode, HttpStatus, Param, Post, RawBodyRequest, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { WEBHOOK_RATE_LIMIT } from "../common/rate-limit";
import { PaymentWebhookService } from "./payments-webhook.service";

// Route publique (aucun JWT : un webhook n'est pas une session utilisateur) —
// la signature (voir PaymentProviderRegistry/docs/adr/0010-...) est l'unique
// garde. rawBody exact requis (main.ts, { rawBody: true }) : la signature
// porte sur les octets bruts, pas sur req.body re-sérialisé.
// Corrige BIL-15 (docs/audit/BILLING-AUDIT.md) : trafic serveur-à-serveur
// (fournisseur de paiement), pas trafic utilisateur — la limite globale
// (100/min) pénaliserait à tort une livraison en rafale ou un rejeu après
// panne réseau. Limite dédiée plus haute, pas de liste blanche d'IP pour
// l'instant (aucun fournisseur réel intégré, voir ADR 0010).
@Throttle(WEBHOOK_RATE_LIMIT)
@Controller("webhooks/payments")
export class PaymentsWebhookController {
  constructor(private readonly webhookService: PaymentWebhookService) {}

  @Post(":provider")
  @HttpCode(HttpStatus.OK)
  handle(@Param("provider") provider: string, @Req() req: RawBodyRequest<Request>) {
    if (!req.rawBody) {
      throw new BadRequestException("Corps de requête brut indisponible");
    }

    return this.webhookService.handle(
      provider,
      req.rawBody,
      req.header("x-webhook-signature"),
      req.header("x-webhook-timestamp"),
    );
  }
}
