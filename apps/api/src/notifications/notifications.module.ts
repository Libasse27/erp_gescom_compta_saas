import { Global, Module } from "@nestjs/common";
import { ConsoleMailSender, MAIL_SENDER } from "./mail-sender";
import { NotificationsService } from "./notifications.service";

@Global()
@Module({
  providers: [{ provide: MAIL_SENDER, useClass: ConsoleMailSender }, NotificationsService],
  exports: [MAIL_SENDER, NotificationsService],
})
export class NotificationsModule {}
