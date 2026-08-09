import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { authenticator } from "otplib";
import { env } from "../config/env";

const ALGORITHM = "aes-256-gcm";

function derivedKey(): Buffer {
  // sha256 comme KDF-lite pour obtenir une clé de 32 octets stable à partir
  // du secret de configuration — pas un hash de mot de passe (voir
  // PasswordService pour argon2id), juste une dérivation de clé symétrique.
  return createHash("sha256").update(env.mfaEncryptionKey()).digest();
}

// Chiffrement/déchiffrement du secret TOTP au repos (User.mfaSecret) et
// vérification des codes à usage unique — otplib pour le protocole TOTP.
@Injectable()
export class MfaService {
  generateSecret(): string {
    return authenticator.generateSecret();
  }

  provisioningUri(secret: string, accountLabel: string, issuer = "ERP GESCOM SaaS"): string {
    return authenticator.keyuri(accountLabel, issuer, secret);
  }

  verifyCode(secret: string, code: string): boolean {
    return authenticator.check(code, secret);
  }

  encryptSecret(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, derivedKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
  }

  decryptSecret(encrypted: string): string {
    const [ivHex, authTagHex, ciphertextHex] = encrypted.split(":");
    if (!ivHex || !authTagHex || !ciphertextHex) {
      throw new Error("Format de secret MFA invalide");
    }
    const decipher = createDecipheriv(ALGORITHM, derivedKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]);
    return plaintext.toString("utf8");
  }
}
