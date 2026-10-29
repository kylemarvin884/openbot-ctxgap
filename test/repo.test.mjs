import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { isDocFile, scanRepo } from "../src/repo.mjs"

test("isDocFile keeps docs and configs, drops source files and data JSON", () => {
  assert.equal(isDocFile("README.md"), true)
  assert.equal(isDocFile("docs/deploy.md"), true)
  assert.equal(isDocFile("AGENTS.md"), true)
  assert.equal(isDocFile(".env.example"), true)
  assert.equal(isDocFile("package.json"), true)
  assert.equal(isDocFile(".mcp.json"), true)
  assert.equal(isDocFile("vite.config.json"), true)
  assert.equal(isDocFile("data/sample.json"), false)
  assert.equal(isDocFile("src/index.ts"), false)
  assert.equal(isDocFile("scripts/deploy.mjs"), false)
})

test("scanRepo can restrict results to git-tracked files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ctxgap-tracked-"))
  try {
    await mkdir(path.join(root, "scratch"), { recursive: true })
    await writeFile(path.join(root, "README.md"), "# demo\n")
    await writeFile(path.join(root, "scratch", "copy.md"), "npm install\n")
    await writeFile(path.join(root, "AGENTS.md"), "npm install\n")

    const { docs, trackedOnly } = await scanRepo(root, { tracked: new Set(["README.md"]) })
    assert.equal(trackedOnly, true)
    assert.deepEqual(docs.map((entry) => entry.path), ["README.md"])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("scanRepo walks docs, skips ignored dirs, binaries and huge files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ctxgap-repo-"))
  try {
    await mkdir(path.join(root, "docs"), { recursive: true })
    await mkdir(path.join(root, "node_modules"), { recursive: true })
    await mkdir(path.join(root, "src"), { recursive: true })
    await writeFile(path.join(root, "README.md"), "# demo\n")
    await writeFile(path.join(root, "docs", "deploy.md"), "API_BASE\n")
    await writeFile(path.join(root, "package.json"), "{}\n")
    await writeFile(path.join(root, "src", "index.ts"), "export {}\n")
    await writeFile(path.join(root, "node_modules", "pkg.md"), "npm install\n")
    await writeFile(path.join(root, "blob.md"), Buffer.from([0x61, 0x00, 0x62]))
    await writeFile(path.join(root, "huge.md"), "x".repeat(300 * 1024))

    const { docs, ignored } = await scanRepo(root)
    const paths = docs.map((entry) => entry.path)
    assert.deepEqual(paths, ["docs/deploy.md", "package.json", "README.md"])
    assert.deepEqual(
      ignored.map((entry) => entry.reason).sort(),
      ["binary", "too-large"],
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
