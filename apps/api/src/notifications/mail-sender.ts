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

export class ConsoleMailSender implements MailSender {
  async send(message: MailMessage): Promise<void> {
    console.log(`[mail:stub] to=${message.to} subject="${message.subject}"\n${message.body}`);
  }
}
