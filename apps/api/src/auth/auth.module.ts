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
    // algorithms épinglé (corrige SEC-01, docs/audit/SECURITY-AUDIT.md) :
    // empêche qu'un jeton signé avec un autre algorithme (ex. "none") soit
    // accepté. issuer/audience/typ sont vérifiés en plus, par appel, dans
    // token.service.ts.
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: env.jwtAccessSecret(),
        signOptions: { algorithm: "HS256" },
        verifyOptions: { algorithms: ["HS256"] },
      }),
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
