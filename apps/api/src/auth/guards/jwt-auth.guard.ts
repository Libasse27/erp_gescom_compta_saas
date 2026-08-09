import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { TokenService } from "../token.service";
import { AuthenticatedUser } from "../types";

export interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Authentification requise");
    }

    try {
      const payload = this.tokenService.verifyAccessToken(authHeader.slice("Bearer ".length));
      request.user = { id: payload.sub, enterpriseId: payload.enterpriseId, isSuperAdmin: payload.isSuperAdmin };
      return true;
    } catch {
      throw new UnauthorizedException("Jeton invalide ou expiré");
    }
  }
}
