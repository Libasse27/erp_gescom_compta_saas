import "reflect-metadata";
import { Throttle } from "@nestjs/throttler";
import { WEBHOOK_RATE_LIMIT } from "./rate-limit";
import { PaymentsWebhookController } from "../payments/payments-webhook.controller";

// Corrige BIL-15 (docs/audit/BILLING-AUDIT.md) : /webhooks/payments/:provider
// reçoit du trafic serveur-à-serveur (fournisseur de paiement livrant en
// rafale ou rejouant un lot après panne réseau), pas du trafic utilisateur —
// la limite globale (100/min) le pénaliserait à tort. Ce test vérifie que le
// contrôleur porte bien la limite dédiée WEBHOOK_RATE_LIMIT. La relation
// « webhooks > global » est vérifiée séparément dans rate-limit.spec.ts
// contre des valeurs de production explicites : les deux limites sont
// délibérément égales (1 000 000) sous NODE_ENV=test, comparer les
// singletons live ici serait donc faux dans cet environnement.

// Classe de référence : on ne recopie jamais les clés de métadonnées privées
// de @nestjs/throttler (non exportées par le package, voir
// auth-throttling.spec.ts) — on demande au décorateur lui-même de les poser
// sur une classe témoin, puis on compare.
class ThrottleReferenceProbe {}
Throttle(WEBHOOK_RATE_LIMIT)(ThrottleReferenceProbe);
const referenceMetadataKeys = Reflect.getMetadataKeys(ThrottleReferenceProbe);

describe("Throttling des webhooks de paiement (BIL-15)", () => {
  it("applique WEBHOOK_RATE_LIMIT à PaymentsWebhookController", () => {
    expect(referenceMetadataKeys.length).toBeGreaterThan(0);
    for (const key of referenceMetadataKeys) {
      expect(Reflect.getMetadata(key, PaymentsWebhookController)).toEqual(
        Reflect.getMetadata(key, ThrottleReferenceProbe),
      );
    }
  });
});
