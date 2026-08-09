import { authenticator } from "otplib";
import { MfaService } from "./mfa.service";

describe("MfaService", () => {
  beforeAll(() => {
    process.env.MFA_ENCRYPTION_KEY = "unit-test-mfa-encryption-key-not-for-production";
  });

  const service = new MfaService();

  it("round-trips a secret through encryptSecret/decryptSecret", () => {
    const secret = service.generateSecret();
    const encrypted = service.encryptSecret(secret);

    expect(encrypted).not.toBe(secret);
    expect(service.decryptSecret(encrypted)).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV) for the same secret", () => {
    const secret = service.generateSecret();
    expect(service.encryptSecret(secret)).not.toBe(service.encryptSecret(secret));
  });

  it("fails to decrypt with a tampered ciphertext", () => {
    const secret = service.generateSecret();
    const encrypted = service.encryptSecret(secret);
    const tampered = encrypted.slice(0, -2) + (encrypted.endsWith("00") ? "ff" : "00");

    expect(() => service.decryptSecret(tampered)).toThrow();
  });

  it("verifies a currently valid TOTP code and rejects an arbitrary one", () => {
    const secret = service.generateSecret();
    const validCode = authenticator.generate(secret);

    expect(service.verifyCode(secret, validCode)).toBe(true);
    expect(service.verifyCode(secret, "000000")).toBe(false);
  });

  it("builds a parsable otpauth:// provisioning URI", () => {
    const secret = service.generateSecret();
    const uri = service.provisioningUri(secret, "admin@platform.test");

    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(encodeURIComponent("admin@platform.test"));
  });
});
