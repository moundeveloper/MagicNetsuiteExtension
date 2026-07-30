import { describe, expect, it } from "vitest";
import { evaluateMathExpression } from "./safeMath";

describe("evaluateMathExpression", () => {
  it("evaluates arithmetic with conventional precedence", () => {
    expect(evaluateMathExpression("2 + 10 * (3 + 4)")).toBe(72);
    expect(evaluateMathExpression("2 ** 3 ** 2")).toBe(512);
  });

  it("supports a constrained set of mathematical helpers", () => {
    expect(evaluateMathExpression("sqrt(81) + max(2, 7)")).toBe(16);
    expect(evaluateMathExpression("round(pi * 100) / 100")).toBe(3.14);
  });

  it("rejects code, unknown identifiers, and non-finite results", () => {
    expect(() => evaluateMathExpression("globalThis.alert(1)")).toThrow();
    expect(() => evaluateMathExpression("constructor")).toThrow();
    expect(() => evaluateMathExpression("1 / 0")).toThrow("Division by zero");
  });
});
