import { Injectable } from "@nestjs/common";
import { Enterprise, Invoice, Prisma } from "@prisma/client";

// TVA 18% (CLAUDE.md §7), en points de base pour éviter tout flottant stocké.
const VAT_RATE_BASIS_POINTS = 1800;

// Émetteur = la plateforme SaaS elle-même (pas l'entreprise cliente). Aucune
// identité légale réelle n'existe encore pour la plateforme à ce stade du
// projet : placeholders explicites, jamais une valeur inventée présentée
// comme réelle.
const PLATFORM_LEGAL_IDENTITY = {
  name: "[Raison sociale de la plateforme à renseigner]",
  ninea: "[NINEA à renseigner]",
  rccm: "[RCCM à renseigner]",
  address: "[Adresse à renseigner], Sénégal",
};

// Numérotation séquentielle par tenant, sans trou, résistante à la
// concurrence (docs/PROMPT-MAITRE-SAAS.md Phase 3 §"points de vigilance").
// tx doit être la même transaction que la mise à jour du Payment/Subscription
// appelante : si le reste de la transaction échoue, l'incrément du compteur
// est annulé avec elle (pas de trou après un rollback).
@Injectable()
export class InvoiceGenerationService {
  async generateForPayment(
    tx: Prisma.TransactionClient,
    params: {
      enterprise: Enterprise;
      subscriptionId: string;
      paymentId: string;
      amount: number;
      currency: string;
    },
  ): Promise<Invoice> {
    const rows = await tx.$queryRaw<{ last_number: number }[]>`
      INSERT INTO invoice_counters (enterprise_id, last_number, updated_at)
      VALUES (${params.enterprise.id}::uuid, 1, now())
      ON CONFLICT (enterprise_id)
      DO UPDATE SET last_number = invoice_counters.last_number + 1, updated_at = now()
      RETURNING last_number
    `;
    const sequenceNumber = rows[0]!.last_number;

    const number = `INV-${params.enterprise.id.slice(0, 8).toUpperCase()}-${String(sequenceNumber).padStart(6, "0")}`;

    const amountExcludingTax = Math.round((params.amount * 10000) / (10000 + VAT_RATE_BASIS_POINTS));
    const vatAmount = params.amount - amountExcludingTax;

    const legalMentions = buildLegalMentions(params.enterprise);

    const now = new Date();

    return tx.invoice.create({
      data: {
        enterpriseId: params.enterprise.id,
        subscriptionId: params.subscriptionId,
        number,
        amount: params.amount,
        amountExcludingTax,
        vatAmount,
        vatRateBasisPoints: VAT_RATE_BASIS_POINTS,
        legalMentions,
        status: "PAID",
        issuedAt: now,
        paidAt: now,
        payments: { connect: { id: params.paymentId } },
      },
    });
  }
}

function buildLegalMentions(enterprise: Enterprise): string {
  return [
    `Émis par : ${PLATFORM_LEGAL_IDENTITY.name}`,
    `NINEA : ${PLATFORM_LEGAL_IDENTITY.ninea} — RCCM : ${PLATFORM_LEGAL_IDENTITY.rccm}`,
    `Adresse : ${PLATFORM_LEGAL_IDENTITY.address}`,
    `Client : ${enterprise.legalName ?? enterprise.name}${enterprise.ninea ? ` — NINEA : ${enterprise.ninea}` : ""}${enterprise.rccm ? ` — RCCM : ${enterprise.rccm}` : ""}`,
    "TVA 18% incluse, conformément à la réglementation en vigueur (UEMOA).",
    "Montants exprimés en FCFA (XOF).",
  ].join("\n");
}
