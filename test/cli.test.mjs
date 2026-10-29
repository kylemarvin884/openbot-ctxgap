import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const cli = path.join(root, "src", "cli.mjs")
const session = path.join(root, "demo", "session.jsonl")
const repo = path.join(root, "demo", "repo")

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" })
}

test("demo session reports the two avoidable failures", () => {
  const result = run(["analyze", session, "--repo", repo])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /3 failed steps · 2 with unread evidence · 2 unread files/)
  assert.match(result.stdout, /CONTRIBUTING\.md:\d+/)
  assert.match(result.stdout, /docs\/deploy\.md:\d+/)
  assert.match(result.stdout, /turn 9\s+Read\s+is_error\s+\(not avoidable\)/)
})

test("--json exposes the same numbers", () => {
  const result = run(["analyze", session, "--repo", repo, "--json"])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.summary.failures, 3)
  assert.equal(payload.summary.avoidable, 2)
  assert.equal(payload.summary.unreadFiles, 2)
  assert.equal(payload.failures.length, 3)
  assert.equal(payload.failures[2].avoidable, false)
})

test("--fail-on-gaps turns unread evidence into exit code 1", () => {
  const result = run(["analyze", session, "--repo", repo, "--fail-on-gaps"])
  assert.equal(result.status, 1)
})

test("--min-score above every match silences the report", () => {
  const result = run(["analyze", session, "--repo", repo, "--json", "--min-score", "99"])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.summary.avoidable, 0)
})

test("usage errors exit 2", () => {
  const missing = run(["analyze", session])
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /session and --repo are required/)

  const unknown = run(["analyze", session, "--repo", repo, "--nope"])
  assert.equal(unknown.status, 2)
  assert.match(unknown.stderr, /unknown option/)

  const badRepo = run(["analyze", session, "--repo", path.join(root, "does-not-exist")])
  assert.equal(badRepo.status, 2)
  assert.match(badRepo.stderr, /repo not found/)
})

test("--help prints usage", () => {
  const result = run(["--help"])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /ctxgap analyze <session\.jsonl> --repo <dir>/)
})
