import { Inject, Injectable } from "@nestjs/common";
import { NotificationChannel, NotificationType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MAIL_SENDER, MailSender } from "./mail-sender";

export interface NotifyParams {
  userId?: string;
  enterpriseId?: string;
  type: NotificationType;
  to: string;
  subject: string;
  // Persisté tel quel dans `Notification.body` — ne doit jamais porter de
  // secret (jeton, mot de passe). Voir BIL-11 (docs/audit/BILLING-AUDIT.md).
  body: string;
  // Contenu réellement envoyé par email quand il diffère de `body` (ex. un
  // jeton qui doit atteindre l'utilisateur mais jamais être persisté).
  // Jamais écrit en base. Retombe sur `body` si absent.
  mailBody?: string;
}

// Comme AuditLogService : créé aussi bien avant qu'un tenant soit connu
// (ex. webhook de paiement, docs/adr/0008-...) que depuis un contexte tenant
// authentifié, et aucun endpoint ne lit encore les notifications d'une
// entreprise via une requête scopée tenant — reste donc sur la connexion
// d'identité (à réévaluer quand un tel endpoint existera).
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
  ) {}

  async notify(params: NotifyParams): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId: params.userId,
        enterpriseId: params.enterpriseId,
        type: params.type,
        channel: NotificationChannel.EMAIL,
        title: params.subject,
        body: params.body,
        sentAt: new Date(),
      },
    });

    await this.mailSender.send({ to: params.to, subject: params.subject, body: params.mailBody ?? params.body });
  }
}
