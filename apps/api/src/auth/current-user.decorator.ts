import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { RequestWithUser } from "./guards/jwt-auth.guard";

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<RequestWithUser>().user;
});
