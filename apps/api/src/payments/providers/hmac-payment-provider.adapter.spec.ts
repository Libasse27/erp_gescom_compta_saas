import { createHmac } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { HmacPaymentProviderAdapter } from "./hmac-payment-provider.adapter";

function sign(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

function nowSeconds(offsetSeconds = 0): string {
  return String(Math.floor(Date.now() / 1000) + offsetSeconds);
}

describe("HmacPaymentProviderAdapter", () => {
  const secret = "test-secret-not-for-production";
  const toleranceSeconds = 300;
  const adapter = new HmacPaymentProviderAdapter(secret, toleranceSeconds);

  describe("verifySignature", () => {
    it("accepts a body signed with the correct secret and a fresh timestamp", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      const timestamp = nowSeconds();
      expect(adapter.verifySignature(Buffer.from(body), sign(secret, timestamp, body), timestamp)).toBe(true);
    });

    it("rejects when the signature does not match the body", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      const timestamp = nowSeconds();
      expect(adapter.verifySignature(Buffer.from(body), sign(secret, timestamp, "tampered"), timestamp)).toBe(false);
    });

    it("rejects when signed with the wrong secret", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      const timestamp = nowSeconds();
      expect(adapter.verifySignature(Buffer.from(body), sign("wrong-secret", timestamp, body), timestamp)).toBe(
        false,
      );
    });

    it("rejects when no signature header is present", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      expect(adapter.verifySignature(Buffer.from(body), undefined, nowSeconds())).toBe(false);
    });

    it("rejects a signature of a different length without throwing", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      expect(adapter.verifySignature(Buffer.from(body), "too-short", nowSeconds())).toBe(false);
    });

    // BIL-06 (docs/audit/BILLING-AUDIT.md) : la fraîcheur du timestamp borne
    // la durée de vie d'un corps signé capté.
    it("rejects when no timestamp header is present, even with an otherwise valid-looking signature", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      expect(adapter.verifySignature(Buffer.from(body), sign(secret, nowSeconds(), body), undefined)).toBe(false);
    });

    it("rejects a non-numeric timestamp header", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      expect(
        adapter.verifySignature(Buffer.from(body), sign(secret, "not-a-number", body), "not-a-number"),
      ).toBe(false);
    });

    it("rejects a timestamp older than the replay tolerance, even with a correctly computed signature", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      const staleTimestamp = nowSeconds(-(toleranceSeconds + 60));
      expect(adapter.verifySignature(Buffer.from(body), sign(secret, staleTimestamp, body), staleTimestamp)).toBe(
        false,
      );
    });

    it("rejects a timestamp further in the future than the replay tolerance", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      const futureTimestamp = nowSeconds(toleranceSeconds + 60);
      expect(adapter.verifySignature(Buffer.from(body), sign(secret, futureTimestamp, body), futureTimestamp)).toBe(
        false,
      );
    });

    it("accepts a timestamp right at the edge of the replay tolerance", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      const edgeTimestamp = nowSeconds(-(toleranceSeconds - 5));
      expect(adapter.verifySignature(Buffer.from(body), sign(secret, edgeTimestamp, body), edgeTimestamp)).toBe(
        true,
      );
    });

    it("rejects a fresh timestamp paired with a signature computed over the body alone (old format)", () => {
      const body = JSON.stringify({ reference: "ref-1", status: "succeeded", amount: 5_000, currency: "XOF" });
      const timestamp = nowSeconds();
      const oldFormatSignature = createHmac("sha256", secret).update(body).digest("hex");
      expect(adapter.verifySignature(Buffer.from(body), oldFormatSignature, timestamp)).toBe(false);
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
