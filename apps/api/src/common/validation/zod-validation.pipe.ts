import { BadRequestException, PipeTransform } from "@nestjs/common";
import { ZodSchema } from "zod";

// Les schémas eux-mêmes vivent dans packages/validation (partagés avec le
// frontend) ; ce pipe n'est que le point de branchement NestJS.
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return result.data;
  }
}
