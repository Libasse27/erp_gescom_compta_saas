import { Injectable, NotFoundException } from "@nestjs/common";
import { PaymentProvider } from "@prisma/client";
import { env } from "../../config/env";
import { HmacPaymentProviderAdapter } from "./hmac-payment-provider.adapter";
import { PaymentProviderAdapter } from "./payment-provider.types";

// Un adaptateur par valeur de PaymentProvider, secret dédié (env.paymentWebhookSecret).
// Remplacer une entrée par un adaptateur dédié au schéma réel d'un
// fournisseur (docs/adr/0010-...) n'affecte aucune autre entrée.
@Injectable()
export class PaymentProviderRegistry {
  private readonly adapters = new Map<PaymentProvider, PaymentProviderAdapter>();

  get(provider: PaymentProvider): PaymentProviderAdapter {
    let adapter = this.adapters.get(provider);
    if (!adapter) {
      adapter = new HmacPaymentProviderAdapter(env.paymentWebhookSecret(provider));
      this.adapters.set(provider, adapter);
    }
    return adapter;
  }

  resolveProvider(value: string): PaymentProvider {
    if (!(value.toUpperCase() in PaymentProvider)) {
      throw new NotFoundException(`Fournisseur de paiement inconnu : ${value}`);
    }
    return value.toUpperCase() as PaymentProvider;
  }
}
