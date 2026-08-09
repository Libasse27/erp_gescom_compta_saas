import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import {
  loginSchema,
  mfaVerifySchema,
  refreshTokenSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "@erp/validation";
import { AUTH_RATE_LIMIT } from "../common/rate-limit";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { AccountRecoveryService } from "./account-recovery.service";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { AuthenticatedUser } from "./types";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

// Message générique : ne confirme jamais si l'email correspond à un compte.
const PASSWORD_RESET_REQUESTED_MESSAGE = "Si un compte existe avec cet email, des instructions ont été envoyées.";

// Throttling plus strict que la limite globale sur toutes les routes /auth/*
// (CLAUDE.md §6 : rate limiting renforcé sur l'authentification).
@Throttle(AUTH_RATE_LIMIT)
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly accountRecoveryService: AccountRecoveryService,
  ) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(loginSchema)) body: { email: string; password: string }, @Req() req: Request) {
    return this.authService.login(body.email, body.password, requestMeta(req));
  }

  @Post("mfa/verify")
  @HttpCode(HttpStatus.OK)
  verifyMfa(
    @Body(new ZodValidationPipe(mfaVerifySchema)) body: { challengeToken: string; code: string },
    @Req() req: Request,
  ) {
    return this.authService.verifyMfaAndIssueTokens(body.challengeToken, body.code, requestMeta(req));
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodValidationPipe(refreshTokenSchema)) body: { refreshToken: string }, @Req() req: Request) {
    return this.authService.refresh(body.refreshToken, requestMeta(req));
  }

  @Post("logout")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: { refreshToken: string },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.authService.logout(body.refreshToken, user.id, requestMeta(req));
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMe(user.id);
  }

  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body(new ZodValidationPipe(requestPasswordResetSchema)) body: { email: string },
    @Req() req: Request,
  ) {
    await this.accountRecoveryService.requestPasswordReset(body.email, requestMeta(req));
    return { message: PASSWORD_RESET_REQUESTED_MESSAGE };
  }

  @Post("reset-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: { token: string; newPassword: string },
    @Req() req: Request,
  ) {
    return this.accountRecoveryService.resetPassword(body.token, body.newPassword, requestMeta(req));
  }

  @Post("verify-email")
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyEmail(@Body(new ZodValidationPipe(verifyEmailSchema)) body: { token: string }, @Req() req: Request) {
    return this.accountRecoveryService.verifyEmail(body.token, requestMeta(req));
  }
}
