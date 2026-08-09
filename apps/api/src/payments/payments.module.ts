import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InvoiceGenerationService } from "./invoice-generation.service";
import { PaymentsBootstrapController } from "./payments-bootstrap.controller";
import { PaymentsBootstrapService } from "./payments-bootstrap.service";
import { PaymentsWebhookController } from "./payments-webhook.controller";
import { PaymentWebhookService } from "./payments-webhook.service";
import { PaymentProviderRegistry } from "./providers/payment-provider.registry";

@Module({
  imports: [AuthModule],
  controllers: [PaymentsBootstrapController, PaymentsWebhookController],
  providers: [PaymentsBootstrapService, PaymentWebhookService, PaymentProviderRegistry, InvoiceGenerationService],
})
export class PaymentsModule {}
