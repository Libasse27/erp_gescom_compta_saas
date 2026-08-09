import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { env } from "../config/env";
import { AccountRecoveryService } from "./account-recovery.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { SuperAdminGuard } from "./guards/super-admin.guard";
import { MfaService } from "./mfa.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: env.jwtAccessSecret() }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccountRecoveryService,
    PasswordService,
    TokenService,
    MfaService,
    JwtAuthGuard,
    SuperAdminGuard,
  ],
  exports: [
    AuthService,
    AccountRecoveryService,
    PasswordService,
    TokenService,
    MfaService,
    JwtAuthGuard,
    SuperAdminGuard,
  ],
})
export class AuthModule {}
