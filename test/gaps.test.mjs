import test from "node:test"
import assert from "node:assert/strict"

import { findGaps, openedFiles, seenFiles, tokenMatcher, wasOpened } from "../src/gaps.mjs"

const doc = (path, lines) => ({ path, content: lines.join("\n"), lines })

function failure(evidence, extra = {}) {
  return {
    turn: 3,
    tool: "Bash",
    kind: "shell",
    subject: "npm install",
    error: "npm ERR!",
    evidence,
    ...extra,
  }
}

const deployPath = (weight = 4) => ({ text: "scripts/deploy.mjs", weight, type: "path" })
const deployCode = (weight = 3) => ({ text: "MISSING_API_BASE", weight, type: "code" })

test("tokenMatcher respects word boundaries", () => {
  assert.equal(tokenMatcher("npm install").test("run npm install first"), true)
  assert.equal(tokenMatcher("npm install").test("run pnpm install first"), false)
  assert.equal(tokenMatcher("scripts/deploy.mjs").test("node scripts/deploy.mjs"), true)
  assert.equal(tokenMatcher("workspace:").test("uses workspace: protocol"), true)
})

test("openedFiles only counts read and edit steps", () => {
  const opened = openedFiles([
    { kind: "read", path: "package.json", input: {} },
    { kind: "edit", path: "src/app.ts", input: {} },
    { kind: "shell", path: "CONTRIBUTING.md", input: {} },
  ])
  assert.equal(opened.size, 2)
  assert.equal(opened.has("package.json"), true)
  assert.equal(opened.has("contributing.md"), false)
})

test("seenFiles also counts files named in shell commands", () => {
  const seen = seenFiles([
    { kind: "read", path: "package.json", input: {} },
    {
      kind: "shell",
      path: "",
      input: { command: "Get-Content C:\\work\\demo\\CONTRIBUTING.md -TotalCount 20" },
    },
    { kind: "shell", path: "", input: { command: "pnpm test" } },
  ])
  assert.equal(seen.has("package.json"), true)
  assert.equal(seen.has("work/demo/contributing.md"), true)
  assert.equal(seen.size, 2)
})

test("wasOpened matches absolute paths from other machines", () => {
  const opened = new Set(["c:/work/demo/contributing.md"])
  assert.equal(wasOpened("CONTRIBUTING.md", opened), true)
  assert.equal(wasOpened("docs/CONTRIBUTING.md", opened), false)
})

test("reports unread files that mention the evidence", () => {
  const docs = [
    doc("docs/deploy.md", ["# Deploy", "Run scripts/deploy.mjs first, otherwise MISSING_API_BASE."]),
    doc("README.md", ["# demo", "pnpm dev"]),
  ]
  const results = findGaps([failure([deployPath(), deployCode()])], docs, new Set())
  assert.equal(results[0].avoidable, true)
  assert.equal(results[0].gaps.length, 1)
  assert.equal(results[0].gaps[0].file, "docs/deploy.md")
  assert.equal(results[0].gaps[0].line, 2)
  assert.equal(results[0].gaps[0].score, 7)
})

test("never reports a file the agent already opened", () => {
  const docs = [doc("docs/deploy.md", ["Run scripts/deploy.mjs first."])]
  const opened = new Set(["docs/deploy.md"])
  const results = findGaps([failure([deployPath()])], docs, opened)
  assert.equal(results[0].avoidable, false)
  assert.equal(results[0].gaps.length, 0)
})

test("shared commands and prose are not evidence", () => {
  const docs = [doc("ci.yml", ["steps: run: npm install"]), doc("notes.md", ["Time range button"])]
  const results = findGaps(
    [
      failure([
        { text: "npm install", weight: 3, type: "command" },
        { text: "Time range", weight: 3, type: "quoted" },
      ]),
    ],
    docs,
    new Set(),
  )
  assert.equal(results[0].avoidable, false)
})

test("API routes are not file evidence", () => {
  const docs = [doc("docs/auth.md", ["DELETE /api/user/sessions"])]
  const results = findGaps(
    [failure([{ text: "/api/user/sessions", weight: 4, type: "path" }])],
    docs,
    new Set(),
  )
  assert.equal(results[0].avoidable, false)
})

test("a single short error code is below the default threshold", () => {
  const docs = [doc("CONTRIBUTING.md", ["ENOENT means the path is wrong"])]
  const results = findGaps(
    [failure([{ text: "ENOENT", weight: 3, type: "code" }])],
    docs,
    new Set(),
  )
  assert.equal(results[0].avoidable, false)
})

test("top limits how many files are reported per failure", () => {
  const docs = ["a.md", "b.md", "c.md"].map((path) => doc(path, ["scripts/deploy.mjs"]))
  const results = findGaps([failure([deployPath()])], docs, new Set(), { top: 2 })
  assert.equal(results[0].gaps.length, 2)
  assert.equal(results[0].totalFiles, 3)
  assert.equal(results[0].avoidable, true)
})
