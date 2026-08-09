import { Global, Module } from "@nestjs/common";
import { ConsoleMailSender, MAIL_SENDER } from "./mail-sender";

@Global()
@Module({
  providers: [{ provide: MAIL_SENDER, useClass: ConsoleMailSender }],
  exports: [MAIL_SENDER],
})
export class NotificationsModule {}
