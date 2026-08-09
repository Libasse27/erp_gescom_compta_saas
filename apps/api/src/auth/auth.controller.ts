import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { loginSchema, refreshTokenSchema } from "@erp/validation";
import { AUTH_RATE_LIMIT } from "../common/rate-limit";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { AuthenticatedUser } from "./types";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

// Throttling plus strict que la limite globale sur toutes les routes /auth/*
// (CLAUDE.md §6 : rate limiting renforcé sur l'authentification).
@Throttle(AUTH_RATE_LIMIT)
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(loginSchema)) body: { email: string; password: string }, @Req() req: Request) {
    return this.authService.login(body.email, body.password, requestMeta(req));
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
}
