import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { env } from "../config/env";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({ secret: env.jwtAccessSecret() }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, JwtAuthGuard],
  exports: [AuthService, TokenService, JwtAuthGuard],
})
export class AuthModule {}
