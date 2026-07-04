#!/usr/bin/env node
// Proves the honesty gate in generate-tests.mjs actually rejects bad output,
// rather than just asserting that it would. Run: node agent/demo-grounding-check.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groundingCheck } from "./generate-tests.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceCode = readFileSync(
  path.resolve(__dirname, "../../app/src/utils/transactionUtils.ts"),
  "utf-8"
);
const moduleSpecifier = "../../../app/src/utils/transactionUtils";

const cases = [
  {
    name: "hallucinated function name",
    generatedCode: `import { test, expect } from "@playwright/test";
import { getPaginatedItems, calculateInterestRate } from "${moduleSpecifier}";
test("a", () => { expect(getPaginatedItems(1, 1, [])).toBeDefined(); });
test("b", () => { expect(calculateInterestRate(100)).toBe(5); });
test("c", () => { expect(1).toBe(1); });
test("d", () => { expect(1).toBe(1); });
test("e", () => { expect(1).toBe(1); });
`,
  },
  {
    name: "vacuous assertions (assert-true boilerplate)",
    generatedCode: `import { test, expect } from "@playwright/test";
import { getPaginatedItems, hasSufficientFunds, formatFullName } from "${moduleSpecifier}";
test("a", () => { expect(true).toBe(true); });
test("b", () => { expect(true).toBe(true); });
test("c", () => { expect(true).toBe(true); });
test("d", () => { expect(true).toBe(true); });
test("e", () => { expect(true).toBe(true); });
`,
  },
  {
    name: "not actually grounded (no import from source at all)",
    generatedCode: `import { test, expect } from "@playwright/test";
test("a", () => { expect(1 + 1).toBe(2); });
test("b", () => { expect(1 + 1).toBe(2); });
test("c", () => { expect(1 + 1).toBe(2); });
test("d", () => { expect(1 + 1).toBe(2); });
test("e", () => { expect(1 + 1).toBe(2); });
`,
  },
  {
    name: "real generated output (should pass)",
    generatedCode: readFileSync(
      path.resolve(__dirname, "../tests/generated/transactionUtils.spec.ts"),
      "utf-8"
    ),
  },
];

let allCorrect = true;
for (const { name, generatedCode } of cases) {
  const result = groundingCheck({ generatedCode, sourceCode, moduleSpecifier });
  const expectedToPass = name.startsWith("real generated");
  const correct = result.passed === expectedToPass;
  allCorrect &&= correct;
  console.log(`[${correct ? "OK" : "WRONG"}] "${name}" -> passed=${result.passed}`);
  if (!result.passed) {
    for (const p of result.problems) console.log(`         - ${p}`);
  }
}

process.exit(allCorrect ? 0 : 1);
