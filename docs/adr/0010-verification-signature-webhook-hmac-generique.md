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

## Mise à jour — 2026-08-18 (BIL-06, docs/audit/BILLING-AUDIT.md)
La signature seule (sur le corps brut) ne bornait pas dans le temps la
validité d'un corps signé capté — un rejeu tardif restait accepté comme
signature valide. `HmacPaymentProviderAdapter.verifySignature` exige
désormais un en-tête `x-webhook-timestamp` (epoch secondes), inclus dans la
chaîne signée (`${timestamp}.${rawBody}`, jamais le corps seul) et comparé à
l'heure serveur avec une tolérance configurable
(`PAYMENT_WEBHOOK_REPLAY_TOLERANCE_SECONDS`, 300 s par défaut — même ordre de
grandeur que la tolérance Stripe citée plus haut). Un timestamp absent, non
numérique, ou hors tolérance (passé ou futur) est rejeté au même titre qu'une
signature invalide.

**Prérequis pour tout futur adaptateur dédié à un fournisseur réel**
(`StripeSignatureAdapter`, etc.) : `PaymentProviderAdapter.verifySignature`
prend maintenant trois paramètres (corps, signature, timestamp). Chaque
adaptateur réel doit apporter sa propre fraîcheur bornée dans le temps, que
le schéma du fournisseur la porte dans un en-tête séparé ou combinée à la
signature (ex. `Stripe-Signature: t=...,v1=...`) — ne jamais réintroduire un
adaptateur dont la signature seule, sans notion de fraîcheur, suffit à
valider indéfiniment un corps capté.

Reste hors périmètre de cette mise à jour (BIL-09, non traité ici) : la
fraîcheur limite la fenêtre de rejeu à quelques minutes, mais ne l'élimine
pas — un rejeu **dans** la fenêtre de tolérance reste accepté comme un
événement légitime, faute d'un magasin d'identifiants d'événements déjà vus.

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
