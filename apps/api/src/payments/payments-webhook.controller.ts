import { BadRequestException, Controller, HttpCode, HttpStatus, Param, Post, RawBodyRequest, Req } from "@nestjs/common";
import { Request } from "express";
import { PaymentWebhookService } from "./payments-webhook.service";

// Route publique (aucun JWT : un webhook n'est pas une session utilisateur) —
// la signature (voir PaymentProviderRegistry/docs/adr/0010-...) est l'unique
// garde. rawBody exact requis (main.ts, { rawBody: true }) : la signature
// porte sur les octets bruts, pas sur req.body re-sérialisé.
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
