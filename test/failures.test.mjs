import test from "node:test"
import assert from "node:assert/strict"

import { extractEvidence, findFailures, isFailure, shortError, subjectOf } from "../src/failures.mjs"

function step(overrides = {}) {
  return {
    turn: 1,
    tool: "Bash",
    kind: "shell",
    input: { command: "npm install" },
    command: "npm install",
    path: "",
    output: "",
    isError: false,
    hasResult: true,
    ...overrides,
  }
}

test("detects failures from flags, exit codes and error lines", () => {
  assert.equal(isFailure(step({ isError: true, output: "anything" })), true)
  assert.equal(isFailure(step({ output: "some log\nExit code 1\nmore" })), true)
  assert.equal(isFailure(step({ output: "npm ERR! code EUNSUPPORTEDPROTOCOL" })), true)
  assert.equal(isFailure(step({ output: "Error: MISSING_API_BASE" })), true)
  assert.equal(isFailure(step({ output: "18 tests passed" })), false)
  assert.equal(isFailure(step({ hasResult: false, output: "Error: not run" })), false)
})

test("does not treat an ordinary log word as a failure", () => {
  assert.equal(isFailure(step({ output: "checked 14 files, no errors found" })), false)
})

test("extracts command and path evidence with weights", () => {
  const tokens = extractEvidence(
    step({
      path: "src/legacy/config.ts",
      input: { file_path: "src/legacy/config.ts" },
      kind: "read",
      output: "ENOENT: no such file or directory, open 'src/legacy/config.ts'",
    }),
  )
  const texts = tokens.map((token) => token.text)
  assert.ok(texts.includes("src/legacy/config.ts"))
  assert.ok(texts.includes("ENOENT"))
  const path = tokens.find((token) => token.text === "src/legacy/config.ts")
  assert.equal(path.weight, 4)
})

test("collapses overlapping tokens so API_BASE is not reported next to MISSING_API_BASE", () => {
  const texts = extractEvidence(
    step({ output: "Error: MISSING_API_BASE is not set\nRun scripts/deploy.mjs with API_BASE exported" }),
  ).map((token) => token.text)
  assert.ok(texts.includes("MISSING_API_BASE"))
  assert.equal(texts.includes("API_BASE"), false)
})

test("long all-caps error codes are strong evidence", () => {
  const tokens = extractEvidence(step({ output: "npm ERR! code EUNSUPPORTEDPROTOCOL" }))
  const code = tokens.find((token) => token.text === "EUNSUPPORTEDPROTOCOL")
  assert.ok(code)
  assert.equal(code.weight, 4)
  assert.equal(tokens.some((token) => token.text === "ERR"), false)
})

test("evidence comes from the error, not from the command the agent typed", () => {
  const texts = extractEvidence(
    step({
      command: "Get-Content AGENTS.md -Raw",
      input: { command: "Get-Content AGENTS.md -Raw" },
      output: "fatal: not a git repository (or any of the parent directories): .git",
    }),
  ).map((token) => token.text)
  assert.equal(texts.includes("AGENTS.md"), false)
  assert.ok(texts.includes("Get-Content AGENTS.md"))
})

test("keeps the command pair as a single strong token", () => {
  const tokens = extractEvidence(step({ input: { command: "pnpm install --frozen-lockfile" }, command: "pnpm install --frozen-lockfile" }))
  const command = tokens.find((token) => token.text === "pnpm install")
  assert.ok(command)
  assert.equal(command.weight, 3)
})

test("subjectOf prefers the command for shell steps and the path otherwise", () => {
  assert.equal(subjectOf(step({ command: "pnpm test", input: { command: "pnpm test" } })), "pnpm test")
  assert.equal(subjectOf(step({ kind: "read", path: "a/b.md", command: "", input: { file_path: "a/b.md" } })), "a/b.md")
})

test("shortError picks the line that explains the failure", () => {
  const output = [
    "> app@1.0.0 deploy",
    "> node scripts/deploy.mjs",
    "",
    "Error: MISSING_API_BASE",
    "    at deploy (scripts/deploy.mjs:12:9)",
  ].join("\n")
  assert.equal(shortError(step({ output })), "Error: MISSING_API_BASE")
})

test("findFailures keeps order and attaches evidence", () => {
  const steps = [
    step({ turn: 1, output: "ok" }),
    step({ turn: 2, output: "Exit code 1" }),
    step({ turn: 3, output: "fine" }),
    step({ turn: 4, kind: "read", path: "src/app.ts", input: { file_path: "src/app.ts" }, output: "ENOENT: no such file or directory" }),
  ]
  const failures = findFailures(steps)
  assert.deepEqual(failures.map((failure) => failure.turn), [2, 4])
  assert.ok(failures[0].evidence.length > 0)
  assert.equal(failures[1].kind, "read")
})
