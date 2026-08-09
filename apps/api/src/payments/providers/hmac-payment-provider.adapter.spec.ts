import { createHmac } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { HmacPaymentProviderAdapter } from "./hmac-payment-provider.adapter";

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("HmacPaymentProviderAdapter", () => {
  const secret = "test-secret-not-for-production";
  const adapter = new HmacPaymentProviderAdapter(secret);

  describe("verifySignature", () => {
    it("accepts a body signed with the correct secret", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      expect(adapter.verifySignature(Buffer.from(body), sign(secret, body))).toBe(true);
    });

    it("rejects when the signature does not match the body", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      expect(adapter.verifySignature(Buffer.from(body), sign(secret, "tampered"))).toBe(false);
    });

    it("rejects when signed with the wrong secret", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      expect(adapter.verifySignature(Buffer.from(body), sign("wrong-secret", body))).toBe(false);
    });

    it("rejects when no signature header is present", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      expect(adapter.verifySignature(Buffer.from(body), undefined)).toBe(false);
    });

    it("rejects a signature of a different length without throwing", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      expect(adapter.verifySignature(Buffer.from(body), "too-short")).toBe(false);
    });
  });

  describe("parseEvent", () => {
    it("parses a valid succeeded event", () => {
      const body = JSON.stringify({ reference: "ref-2", status: "succeeded", amount: 12_000, currency: "XOF" });
      expect(adapter.parseEvent(Buffer.from(body))).toEqual({
        providerReference: "ref-2",
        status: "SUCCEEDED",
        amount: 12_000,
        currency: "XOF",
      });
    });

    it("parses a valid failed event", () => {
      const body = JSON.stringify({ reference: "ref-3", status: "failed", amount: 12_000, currency: "XOF" });
      expect(adapter.parseEvent(Buffer.from(body)).status).toBe("FAILED");
    });

    it("rejects malformed JSON", () => {
      expect(() => adapter.parseEvent(Buffer.from("not json"))).toThrow(BadRequestException);
    });

    it("rejects a payload missing required fields", () => {
      expect(() => adapter.parseEvent(Buffer.from(JSON.stringify({ status: "succeeded" })))).toThrow(
        BadRequestException,
      );
    });
  });
});
