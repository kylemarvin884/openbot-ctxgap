#!/usr/bin/env node
import { stat } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

import { parseSessionFile } from "./parse.mjs"
import { findFailures } from "./failures.mjs"
import { scanRepo } from "./repo.mjs"
import { trackedFiles } from "./git.mjs"
import { findGaps, seenFiles } from "./gaps.mjs"
import { renderJson, renderMarkdown, summarize } from "./report.mjs"

const USAGE = `ctxgap — find the repo files that would have prevented your agent's failed turns

Usage:
  ctxgap analyze <session.jsonl> --repo <dir> [options]

Options:
  --repo <dir>        Repository to search (required)
  --json              Machine-readable output
  --fail-on-gaps      Exit 1 when at least one failure had unread evidence
  --min-score <n>     Evidence score needed to report a file (default 4)
  --top <n>           Max files reported per failure (default 3)
  -h, --help          Show this help

Supported sessions:
  Claude Code (~/.claude/projects/**/*.jsonl), Codex (~/.codex/sessions/**/*.jsonl),
  and a generic JSONL of tool_call / tool_result lines (see README).

Exit codes:
  0  analysis done
  1  --fail-on-gaps and unread evidence was found
  2  usage or input error
`

function toPosix(value) {
  return String(value).replace(/\\/g, "/")
}

function parseArgs(argv) {
  const options = { json: false, failOnGaps: false, minScore: 4, top: 3 }
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--json") options.json = true
    else if (arg === "--fail-on-gaps") options.failOnGaps = true
    else if (arg === "-h" || arg === "--help") options.help = true
    else if (arg === "--repo") options.repo = argv[++index]
    else if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length)
    else if (arg === "--min-score") options.minScore = Number(argv[++index])
    else if (arg.startsWith("--min-score=")) options.minScore = Number(arg.slice("--min-score=".length))
    else if (arg === "--top") options.top = Number(argv[++index])
    else if (arg.startsWith("--top=")) options.top = Number(arg.slice("--top=".length))
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`)
    else positional.push(arg)
  }
  if (positional[0] === "analyze") positional.shift()
  options.session = positional[0]
  return options
}

async function assertDir(dir, label) {
  let info
  try {
    info = await stat(dir)
  } catch {
    throw new Error(`${label} not found: ${dir}`)
  }
  if (!info.isDirectory()) throw new Error(`${label} is not a directory: ${dir}`)
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`)
    process.exit(2)
  }

  if (options.help) {
    process.stdout.write(USAGE)
    process.exit(0)
  }
  if (!options.session || !options.repo) {
    process.stderr.write(`session and --repo are required\n\n${USAGE}`)
    process.exit(2)
  }
  if (!Number.isFinite(options.minScore) || !Number.isFinite(options.top)) {
    process.stderr.write("--min-score and --top must be numbers\n")
    process.exit(2)
  }

  try {
    await assertDir(options.repo, "repo")
    const session = await parseSessionFile(options.session).catch((error) => {
      throw new Error(`cannot read session ${options.session}: ${error.message}`)
    })
    const failures = findFailures(session.steps)
    const opened = seenFiles(session.steps)
    const tracked = trackedFiles(options.repo)
    const { root, docs, ignored } = await scanRepo(options.repo, { tracked: tracked.files })
    const results = findGaps(failures, docs, opened, {
      minScore: options.minScore,
      top: options.top,
    })

    const payload = {
      session: toPosix(path.relative(process.cwd(), path.resolve(options.session)) || options.session),
      repo: toPosix(path.relative(process.cwd(), root) || root),
      results,
      stats: {
        steps: session.steps.length,
        ignored: ignored.length,
        badLines: session.stats.badLines,
        files: docs.length,
        tracked: tracked.available,
      },
    }

    process.stdout.write(
      options.json ? `${renderJson(payload)}\n` : renderMarkdown(payload),
    )

    const summary = summarize(results, payload.stats)
    if (options.failOnGaps && summary.avoidable > 0) process.exit(1)
    process.exit(0)
  } catch (error) {
    process.stderr.write(`ctxgap: ${error.message}\n`)
    process.exit(2)
  }
}

await main()
