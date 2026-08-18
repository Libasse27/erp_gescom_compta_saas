import { BadRequestException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { paymentWebhookEventSchema } from "@erp/validation";
import { PaymentProviderAdapter, PaymentWebhookEvent } from "./payment-provider.types";

// HMAC-SHA256 générique sur `${timestamp}.${rawBody}`, en attendant le schéma
// de signature réel de chaque fournisseur (docs/adr/0010-...). Comparaison en
// temps constant : ne jamais comparer des signatures avec `===` (fuite de
// timing exploitable pour deviner la signature attendue octet par octet).
//
// Le timestamp (BIL-06, docs/audit/BILLING-AUDIT.md) borne la durée de vie
// d'un corps signé : sans lui, un corps capté une fois (log, proxy compromis)
// reste rejouable indéfiniment. Il est inclus dans la chaîne signée (pas
// seulement comparé à côté) pour qu'un attaquant ne puisse pas coller un
// timestamp frais à une ancienne paire (corps, signature) sans en recalculer
// la signature — ce qu'il ne peut pas faire sans le secret.
export class HmacPaymentProviderAdapter implements PaymentProviderAdapter {
  constructor(
    private readonly secret: string,
    private readonly replayToleranceSeconds: number,
  ) {}

  verifySignature(rawBody: Buffer, signatureHeader: string | undefined, timestampHeader: string | undefined): boolean {
    if (!signatureHeader || !timestampHeader || !/^\d+$/.test(timestampHeader)) {
      return false;
    }

    const timestampSeconds = Number(timestampHeader);
    const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
    if (ageSeconds > this.replayToleranceSeconds) {
      return false;
    }

    const signedPayload = Buffer.concat([Buffer.from(`${timestampHeader}.`, "utf8"), rawBody]);
    const expected = createHmac("sha256", this.secret).update(signedPayload).digest("hex");
    const expectedBuffer = Buffer.from(expected, "utf8");
    const providedBuffer = Buffer.from(signatureHeader, "utf8");

    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, providedBuffer);
  }

  parseEvent(rawBody: Buffer): PaymentWebhookEvent {
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new BadRequestException("Corps de webhook invalide (JSON attendu)");
    }

    const parsed = paymentWebhookEventSchema.safeParse(json);
    if (!parsed.success) {
      throw new BadRequestException("Événement de webhook invalide");
    }

    return {
      providerReference: parsed.data.reference,
      status: parsed.data.status === "succeeded" ? "SUCCEEDED" : "FAILED",
      amount: parsed.data.amount,
      currency: parsed.data.currency,
    };
  }
}
