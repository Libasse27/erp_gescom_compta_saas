import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

// argon2id, coût par défaut de la librairie (>= recommandations OWASP) —
// CLAUDE.md §6 : "jamais de hash maison".
@Injectable()
export class PasswordService {
  hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, { type: argon2.argon2id });
  }

  verify(passwordHash: string, plainPassword: string): Promise<boolean> {
    return argon2.verify(passwordHash, plainPassword);
  }
}
