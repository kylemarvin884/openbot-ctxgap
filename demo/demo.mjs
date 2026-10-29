#!/usr/bin/env node
// Reproducible demo: 12-step Claude Code session, 3 failed turns, 2 of them
// avoidable because the repo already documented the answer in a file the
// agent never opened.
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")

const run = spawnSync(
  process.execPath,
  [path.join(root, "src", "cli.mjs"), "analyze", path.join(here, "session.jsonl"), "--repo", path.join(here, "repo")],
  { cwd: root, stdio: "inherit" },
)

process.exit(run.status ?? 1)
