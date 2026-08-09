# 0010 — Vérification de signature des webhooks de paiement : HMAC générique en attendant les identifiants marchands réels

## Statut
Tranché — 2026-08-09

## Contexte
La Phase 5 (`docs/PROMPT-MAITRE-SAAS.md`) exige que chaque webhook de
paiement (Wave, Orange Money, Free Money, Stripe, carte) ait sa **signature
vérifiée** avant tout traitement. Chaque fournisseur a son propre schéma de
signature (ex. Stripe : en-tête `Stripe-Signature`, horodatage +
HMAC-SHA256 sur `timestamp.payload`, tolérance de rejeu bornée dans le
temps). Aucun compte marchand réel n'existe pour ce projet à ce stade —
aucun identifiant, aucune documentation d'intégration vérifiée en main pour
un fournisseur précis.

Deux options :
1. Deviner/reconstituer le schéma de signature exact d'un fournisseur réel
   (ex. Stripe) sans pouvoir le vérifier contre un vrai compte sandbox.
2. Implémenter un mécanisme de signature générique (HMAC-SHA256, secret
   partagé par fournisseur), le même pour les 5 valeurs de
   `PaymentProvider`, en attendant l'intégration réelle de chacun.

## Décision
Option 2. Un seul adaptateur (`HmacPaymentProviderAdapter`) implémente
`PaymentProviderAdapter` (`verifySignature`/`parseEvent`) via HMAC-SHA256 sur
le corps brut de la requête, comparaison en temps constant
(`crypto.timingSafeEqual`). Un secret distinct par fournisseur
(`PAYMENT_WEBHOOK_SECRET_<PROVIDER>`, `env.paymentWebhookSecret()`).

Tout ce qui entoure la vérification de signature (idempotence par
`(provider, providerReference)`, machine à états de l'abonnement, génération
de facture, notification) est indépendant du schéma de signature exact et ne
change pas quand un fournisseur réel sera branché : seul
`HmacPaymentProviderAdapter` sera alors remplacé, pour ce fournisseur
uniquement, par un adaptateur dédié à son schéma réel
(`StripeSignatureAdapter`, etc.) implémentant la même interface.

## Conséquences
- Aucun webhook de paiement réel (Wave, Orange Money, Stripe...) ne peut
  être accepté aujourd'hui : ce mécanisme n'est vérifié qu'avec des secrets
  de test, générés localement. C'est un placeholder assumé, pas une
  intégration terminée.
- Le jour où un compte marchand existe, seul le fichier de l'adaptateur
  concerné change — `PaymentWebhookService`, la machine à états, la
  facturation restent inchangés (le contrat `PaymentProviderAdapter` est le
  point de variation unique).
- Ne pas confondre avec la signature JWT (RS256/HS256 côté auth) ni avec la
  vérification MFA (TOTP) : mécanismes indépendants, sans lien.
