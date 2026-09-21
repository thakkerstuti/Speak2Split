import { extractReceiptFields } from "../src/parsing/receipt-parser";

describe("receipt field extraction", () => {
  it("extracts a clearly labeled TOTAL, not just the largest number", () => {
    const receipt = `
BIG BAZAAR SUPERMARKET
123 MG Road, Bangalore
Date: 12/09/2026

Milk              80.00
Bread             45.00
Rice              350.00
Subtotal          475.00
Tax (5%)          23.75
TOTAL             498.75
    `;
    const result = extractReceiptFields(receipt);
    expect(result.amount).toBe(498.75);
    expect(result.amountSource).toBe("labeled_total");
    // The largest raw number in this receipt is actually the subtotal-ish
    // "498.75" itself here, but let's make sure it's not accidentally
    // picking "350.00" or something unrelated — TOTAL must win explicitly.
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("prefers GRAND TOTAL over a plain TOTAL when both are present", () => {
    const receipt = `
CAFE COFFEE DAY
Item Total: 250.00
Total: 250.00
Service Charge: 25.00
Grand Total: 275.00
    `;
    const result = extractReceiptFields(receipt);
    expect(result.amount).toBe(275.0);
    expect(result.amountSource).toBe("labeled_grand_total");
  });

  it("handles Indian Rupee formatting with commas and the ₹ symbol", () => {
    const receipt = `
D-MART
Grand Total: ₹2,499.00
    `;
    const result = extractReceiptFields(receipt);
    expect(result.amount).toBe(2499.0);
  });

  it("does NOT blindly pick the largest number when no label matches at all — but flags low confidence", () => {
    const receipt = `
UNKNOWN RECEIPT FORMAT
99999
42
7
    `;
    const result = extractReceiptFields(receipt);
    expect(result.amountSource).toBe("fallback_largest");
    expect(result.amount).toBe(99999);
    expect(result.confidence).toBeLessThan(0.5); // caller must warn the user
  });

  it("extracts a merchant name from the top of the receipt", () => {
    const receipt = `
Zomato Restaurant Partner
Order #12345
Total: 350.00
    `;
    const result = extractReceiptFields(receipt);
    expect(result.merchant).toContain("Zomato");
  });

  it("extracts and normalizes a DD/MM/YYYY date", () => {
    const receipt = `Store\nDate: 05/03/2026\nTotal: 100.00`;
    const result = extractReceiptFields(receipt);
    expect(result.date).toBe("2026-03-05");
  });

  it("returns very low confidence and null amount when nothing usable is found", () => {
    const receipt = `blurry illegible garbage`;
    const result = extractReceiptFields(receipt);
    expect(result.amount).toBeNull();
    expect(result.confidence).toBeLessThan(0.2);
  });

  it("categorizes groceries, electricity, and taxi receipts correctly", () => {
    expect(extractReceiptFields("D-Mart Supermarket\nTotal: 500").category).toBe("groceries");
    expect(extractReceiptFields("State Electricity Board\nTotal: 1200").category).toBe("electricity");
    expect(extractReceiptFields("Uber Trip Receipt\nTotal: 250").category).toBe("taxi");
  });

  it("handles AMOUNT DUE as a fallback label when no TOTAL is present", () => {
    const receipt = `Clinic Visit\nAmount Due: 800.00`;
    const result = extractReceiptFields(receipt);
    expect(result.amount).toBe(800);
    expect(result.amountSource).toBe("labeled_amount_due");
  });
});
