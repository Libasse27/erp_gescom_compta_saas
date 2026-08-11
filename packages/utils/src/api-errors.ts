// Les erreurs API n'ont pas toutes la même forme : {statusCode,message,error}
// pour les erreurs métier, {fieldErrors,formErrors} pour les erreurs de
// validation Zod (voir ZodValidationPipe côté API) — ce helper couvre les deux.
// Partagé entre apps/web (BFF Next.js) et apps/mobile (appel direct à l'API).
export function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.message === "string") {
      return record.message;
    }
    if (Array.isArray(record.message) && record.message.length > 0) {
      return String(record.message[0]);
    }
    const fieldErrors = record.fieldErrors as Record<string, string[]> | undefined;
    if (fieldErrors) {
      const firstField = Object.values(fieldErrors).find((errors) => errors.length > 0);
      if (firstField) {
        return firstField[0]!;
      }
    }
    const formErrors = record.formErrors as string[] | undefined;
    if (formErrors && formErrors.length > 0) {
      return formErrors[0]!;
    }
  }
  return fallback;
}
