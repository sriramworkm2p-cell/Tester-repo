#!/usr/bin/env node
// Test-writing agent (Task 2).
//
// Reads one real source file from the app under test, asks Claude (via the
// `claude` CLI in headless/-p mode) to generate Playwright tests grounded in
// that exact code, then mechanically checks the output before trusting it --
// see `groundingCheck()` below. Nothing is written to tests/generated/ unless
// it passes those checks.
//
// Usage:
//   node agent/generate-tests.mjs --file ../app/src/utils/transactionUtils.ts --out transactionUtils.spec.ts
//
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { run: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") args.file = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--no-run") args.run = false;
    else if (a === "--model") args.model = argv[++i];
  }
  if (!args.file || !args.out) {
    console.error(
      "Usage: node agent/generate-tests.mjs --file <path-to-source-file> --out <output-filename.spec.ts> [--model <alias>] [--no-run]"
    );
    process.exit(1);
  }
  return args;
}

// Every export the file makes available, so we can check later that the
// agent only imported real names -- not ones it hallucinated.
function extractExportedNames(sourceCode) {
  const names = new Set();
  const patterns = [
    /export\s+const\s+([A-Za-z0-9_]+)/g,
    /export\s+function\s+([A-Za-z0-9_]+)/g,
    /export\s+async\s+function\s+([A-Za-z0-9_]+)/g,
  ];
  for (const re of patterns) {
    for (const m of sourceCode.matchAll(re)) names.add(m[1]);
  }
  return names;
}

function extractImportedNames(generatedCode, moduleSpecifier) {
  const escaped = moduleSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`import\\s*{([^}]+)}\\s*from\\s*["']${escaped}["']`);
  const match = generatedCode.match(re);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function stripMarkdownFences(text) {
  const fenced = text.match(/```(?:ts|typescript)?\n([\s\S]*?)```/);
  return fenced ? fenced[1] : text;
}

/**
 * The honesty gate. An LLM will happily produce plausible-looking tests
 * that don't touch the real module at all, or that assert nothing
 * meaningful. This function is deterministic (no LLM involved) and refuses
 * to let output through that fails any of these checks.
 */
export function groundingCheck({ generatedCode, sourceCode, moduleSpecifier }) {
  const problems = [];

  const exported = extractExportedNames(sourceCode);
  const imported = extractImportedNames(generatedCode, moduleSpecifier);

  if (imported.length === 0) {
    problems.push(`No import found from "${moduleSpecifier}" -- test isn't grounded in the target file at all.`);
  }

  const hallucinated = imported.filter((name) => !exported.has(name));
  if (hallucinated.length > 0) {
    problems.push(
      `Imported name(s) not actually exported by the source file: ${hallucinated.join(", ")}`
    );
  }

  if (imported.length > 0 && imported.length - hallucinated.length < 3) {
    problems.push(
      `Only exercises ${imported.length - hallucinated.length} real exported function(s); expected at least 3 for meaningful coverage.`
    );
  }

  const testCount = (generatedCode.match(/\btest\(/g) || []).length;
  const expectCount = (generatedCode.match(/\bexpect\(/g) || []).length;

  if (testCount < 5) {
    problems.push(`Only ${testCount} test() blocks found; expected at least 5.`);
  }
  if (expectCount < testCount) {
    problems.push(
      `${expectCount} expect() calls for ${testCount} tests -- some tests likely assert nothing.`
    );
  }

  const forbidden = [/expect\(true\)\.toBe\(true\)/, /expect\(1\)\.toBe\(1\)/, /\.skip\(/, /\.only\(/, /TODO/i];
  for (const pattern of forbidden) {
    if (pattern.test(generatedCode)) {
      problems.push(`Contains forbidden placeholder pattern: ${pattern}`);
    }
  }

  return { passed: problems.length === 0, problems, exercisedFunctions: imported.filter((n) => exported.has(n)) };
}

function buildPrompt({ sourceCode, sourceRelativePath, moduleSpecifier }) {
  return `You are generating Playwright tests for a specific real source file. This is
a screening exercise about writing tests GROUNDED in real code -- not generic
boilerplate. Follow the contract exactly.

SOURCE FILE: ${sourceRelativePath}
\`\`\`typescript
${sourceCode}
\`\`\`

TASK
Generate a single Playwright test file that tests this file's exported pure
functions. Playwright's test runner supports plain assertion tests with no
browser, using \`import { test, expect } from "@playwright/test"\`.

REQUIREMENTS (all mandatory)
1. Import the functions you test with:
   import { <names> } from "${moduleSpecifier}";
   Only import names that are ACTUALLY exported in the source above. Do not
   invent function names.
2. Exercise at least 4 different exported functions from the file, chosen for
   real business-logic risk (money/currency math, pagination boundaries,
   date/timezone conversions, query-object shape checks) over trivial getters.
3. Write at least 6 test() cases. Cover at least one genuine edge case per
   function under test (e.g. page 1 vs a later page, an empty items array, a
   limit that exceeds the item count, exact-balance vs insufficient-balance,
   an object missing the fields being checked for).
4. Every test must call expect() at least once on the ACTUAL return value of
   the real function -- never assert a hardcoded literal against itself
   (e.g. never expect(true).toBe(true) or expect(1).toBe(1)).
5. Do not use test.skip or test.only.
6. Keep each test's assertion traceable to the function's real behavior --
   prefer computing an expected value from the same inputs (or a manually
   worked-out expected constant with a one-line comment showing the math)
   over vague "toBeDefined()" checks.

OUTPUT CONTRACT
Output ONLY the raw TypeScript file contents. No markdown code fences, no
prose before or after, no explanation. Start directly with the import
statements.`;
}

function callClaude(prompt, model) {
  // No tool actually matches "none" -- this is how we force a pure text
  // completion (the prompt already inlines the full source, so the model
  // has no legitimate reason to need tool access anyway).
  const args = ["-p", "--output-format", "json", "--allowedTools", "none"];
  if (model) args.push("--model", model);

  const result = spawnSync("claude", args, {
    input: prompt,
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    console.error(result.stderr);
    throw new Error(`claude CLI exited with status ${result.status}`);
  }

  const parsed = JSON.parse(result.stdout);
  if (parsed.is_error) {
    throw new Error(`claude CLI reported an error: ${parsed.result}`);
  }
  return { text: parsed.result, modelUsage: parsed.modelUsage, costUSD: parsed.total_cost_usd };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const sourcePath = path.resolve(REPO_ROOT, args.file);
  if (!existsSync(sourcePath)) {
    console.error(`Source file not found: ${sourcePath}`);
    process.exit(1);
  }
  const sourceCode = readFileSync(sourcePath, "utf-8");

  const outDir = path.join(REPO_ROOT, "tests", "generated");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, args.out);

  // Relative import path from the output test file back to the source file.
  const moduleSpecifier = path
    .relative(outDir, sourcePath)
    .replace(/\\/g, "/")
    .replace(/\.tsx?$/, "");
  const moduleSpecifierNormalized = moduleSpecifier.startsWith(".") ? moduleSpecifier : `./${moduleSpecifier}`;

  console.log(`Reading:  ${path.relative(REPO_ROOT, sourcePath)}`);
  console.log(`Import:   ${moduleSpecifierNormalized}`);
  console.log(`Calling claude CLI (this may take a bit)...`);

  const prompt = buildPrompt({
    sourceCode,
    sourceRelativePath: path.relative(REPO_ROOT, sourcePath),
    moduleSpecifier: moduleSpecifierNormalized,
  });

  const { text, modelUsage, costUSD } = callClaude(prompt, args.model);
  const generatedCode = stripMarkdownFences(text).trim() + "\n";

  const reportDir = path.join(__dirname, "output");
  mkdirSync(reportDir, { recursive: true });

  const check = groundingCheck({
    generatedCode,
    sourceCode,
    moduleSpecifier: moduleSpecifierNormalized,
  });

  const timestamp = new Date().toISOString();
  const report = {
    timestamp,
    sourceFile: path.relative(REPO_ROOT, sourcePath),
    outputFile: `tests/generated/${args.out}`,
    modelUsage,
    costUSD,
    groundingCheck: check,
  };

  if (!check.passed) {
    const rejectedPath = path.join(reportDir, args.out.replace(/\.ts$/, ".REJECTED.ts"));
    writeFileSync(rejectedPath, generatedCode, "utf-8");
    writeFileSync(
      path.join(reportDir, args.out.replace(/\.ts$/, ".report.json")),
      JSON.stringify(report, null, 2),
      "utf-8"
    );
    console.error("\nGrounding check FAILED -- not writing to tests/generated/. Problems:");
    for (const p of check.problems) console.error(`  - ${p}`);
    console.error(`\nRejected output saved for inspection: ${path.relative(REPO_ROOT, rejectedPath)}`);
    process.exit(1);
  }

  const header = `// AUTO-GENERATED by agent/generate-tests.mjs on ${timestamp}
// Source: ${path.relative(REPO_ROOT, sourcePath)}
// Exercises real exports: ${check.exercisedFunctions.join(", ")}
// Passed grounding check -- see agent/output/${args.out.replace(/\.ts$/, ".report.json")}
`;
  writeFileSync(outPath, header + generatedCode, "utf-8");
  writeFileSync(
    path.join(reportDir, args.out.replace(/\.ts$/, ".report.json")),
    JSON.stringify(report, null, 2),
    "utf-8"
  );

  console.log(`\nGrounding check PASSED. Exercised real functions: ${check.exercisedFunctions.join(", ")}`);
  console.log(`Written: ${path.relative(REPO_ROOT, outPath)}`);
  console.log(`Model usage: ${JSON.stringify(modelUsage)}`);

  if (args.run) {
    console.log("\nRunning the generated test to close the loop...\n");
    const runResult = spawnSync(
      "npx",
      ["playwright", "test", `tests/generated/${args.out}`, "--project=generated"],
      { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" }
    );
    process.exit(runResult.status ?? 1);
  }
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main();
}
