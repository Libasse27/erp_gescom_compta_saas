import { BadRequestException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { paymentWebhookEventSchema } from "@erp/validation";
import { PaymentProviderAdapter, PaymentWebhookEvent } from "./payment-provider.types";

// HMAC-SHA256 générique sur le corps brut, en attendant le schéma de
// signature réel de chaque fournisseur (docs/adr/0010-...). Comparaison en
// temps constant : ne jamais comparer des signatures avec `===` (fuite de
// timing exploitable pour deviner la signature attendue octet par octet).
export class HmacPaymentProviderAdapter implements PaymentProviderAdapter {
  constructor(private readonly secret: string) {}

  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) {
      return false;
    }

    const expected = createHmac("sha256", this.secret).update(rawBody).digest("hex");
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
