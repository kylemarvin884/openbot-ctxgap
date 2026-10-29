import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".codex",
  ".claude",
  "node_modules",
  "bower_components",
  "jspm_packages",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  ".eggs",
  "site-packages",
  "__pypackages__",
  ".cache",
  ".turbo",
  "vendor",
  "vendored",
  "third_party",
  "thirdparty",
  "external",
  "extern",
  "pods",
  "target",
])

const DOC_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".markdown",
  ".txt",
  ".rst",
  ".adoc",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".example",
  ".lock",
  ".properties",
  ".nvmrc",
  ".node-version",
  ".tool-versions",
])

const DOC_NAMES = /^(readme|contributing|agents|claude|gemini|copilot|codeowners|changelog|security|architecture|design|notes)/i
const TOOL_NAMES = /^(makefile|justfile|dockerfile|procfile|brewfile)$/i

// JSON is mostly data, not knowledge. Only keep files that carry repo conventions.
const CONFIG_JSON = /^(package|package-lock|tsconfig|jsconfig|composer|deno|turbo|nx|vercel|now|angular|renovate|biome|\.mcp|\.eslintrc|\.prettierrc)[^/]*\.jsonc?$/i
const CONFIG_JSON_SUFFIX = /\.config\.jsonc?$/i

const MAX_BYTES = 256 * 1024
const MAX_FILES = 4000

export function isDocFile(relativePath) {
  const base = path.basename(relativePath)
  const ext = path.extname(base).toLowerCase()
  if (base.startsWith(".env")) return true
  if (TOOL_NAMES.test(base)) return true
  // "claude-settings-card.tsx" is source code, not a CLAUDE.md.
  if (DOC_NAMES.test(base) && (ext === "" || DOC_EXTENSIONS.has(ext))) return true
  if (CONFIG_JSON.test(base) || CONFIG_JSON_SUFFIX.test(base)) return true
  return DOC_EXTENSIONS.has(ext)
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, 8192)
  return sample.includes(0)
}

/**
 * Collect text files that could carry repo knowledge (docs, configs, AGENTS.md).
 * When a `tracked` set is supplied only git-tracked files are considered, so
 * scratch worktrees and build copies inside the repo are skipped.
 * Deterministic order keeps reports and tests stable.
 */
export async function scanRepo(rootDir, { maxFiles = MAX_FILES, maxBytes = MAX_BYTES, tracked = null } = {}) {
  const root = path.resolve(rootDir)
  const docs = []
  const ignored = []
  let visited = 0

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (docs.length >= maxFiles) return
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      visited += 1
      const relative = path.relative(root, absolute).split(path.sep).join("/")
      if (tracked && !tracked.has(relative)) continue
      if (!isDocFile(relative)) continue
      const info = await stat(absolute)
      if (info.size > maxBytes) {
        ignored.push({ path: relative, reason: "too-large" })
        continue
      }
      const buffer = await readFile(absolute)
      if (looksBinary(buffer)) {
        ignored.push({ path: relative, reason: "binary" })
        continue
      }
      const content = buffer.toString("utf8")
      docs.push({
        path: relative,
        content,
        lines: content.split(/\r?\n/),
      })
    }
  }

  await walk(root)
  docs.sort((a, b) => a.path.localeCompare(b.path))
  ignored.sort((a, b) => a.path.localeCompare(b.path))
  return { root, docs, ignored, visited, trackedOnly: Boolean(tracked) }
}
