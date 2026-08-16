import { randomUUID } from "node:crypto";

// Abstraction minimale pour ne pas coupler l'auth à un fournisseur d'email —
// la vraie intégration (SMTP/provider transactionnel) est l'objet de la
// Phase 24 (Notifications) du prompt maître. En attendant, ConsoleMailSender
// journalise ce qui aurait été envoyé (jamais de vrai envoi en dev/test).
export interface MailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

export const MAIL_SENDER = Symbol("MAIL_SENDER");

// Corrige SEC-04 (docs/audit/SECURITY-AUDIT.md) : `body` porte parfois un
// jeton brut (réinitialisation de mot de passe, invitation — voir
// account-recovery.service.ts, invitations.service.ts). Ce stub ne doit
// donc jamais l'écrire en clair dans un journal destiné à être agrégé
// (CLAUDE.md §6 — un accès en lecture aux logs ne doit pas suffire à
// prendre le contrôle d'un compte). Un identifiant de message généré
// remplace le corps pour permettre de corréler un envoi dans les logs sans
// jamais y exposer son contenu.
export class ConsoleMailSender implements MailSender {
  async send(message: MailMessage): Promise<void> {
    console.log(`[mail:stub] to=${message.to} subject="${message.subject}" messageId=${randomUUID()}`);
  }
}
