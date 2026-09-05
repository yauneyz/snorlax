import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

/**
 * `next build` runs ESLint and fails the Vercel deploy on any error — but that
 * feedback previously only arrived after a push. Run the same check here so it
 * shows up in the regular test suite instead.
 */
describe("eslint", () => {
  it("has no lint errors", async () => {
    const eslint = new ESLint({ cwd: __dirname + "/../.." });
    const results = await eslint.lintFiles(["src/**/*.{ts,tsx}"]);
    const errors = results.flatMap((result) =>
      result.messages
        .filter((message) => message.severity === 2)
        .map((message) => `${result.filePath}:${message.line}:${message.column}  ${message.message}`),
    );

    expect(errors, errors.join("\n")).toEqual([]);
  }, 60_000);
});
