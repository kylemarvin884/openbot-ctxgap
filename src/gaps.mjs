import { commandOf, pathOf } from "./parse.mjs"
import { ERROR_CODE_SET, STOP_CODE_SET } from "./failures.mjs"

function normalizePath(value) {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^[a-z]:\//i, "")
    .toLowerCase()
}

/** Files the agent itself opened (read or edited) during this session. */
export function openedFiles(steps) {
  const opened = new Set()
  for (const step of steps) {
    if (step.kind !== "read" && step.kind !== "edit") continue
    const target = pathOf(step)
    if (target) opened.add(normalizePath(target))
  }
  return opened
}

/**
 * Everything the agent plausibly saw: files it opened directly, plus files whose
 * path appears in a shell command (`cat x.md`, `Get-Content x.md`, `apply_patch`
 * onto x.json). A shell-visible file is not a "never opened" file, even though we
 * cannot prove the agent read it — we prefer missing a finding to a false one.
 */
export function seenFiles(steps) {
  const seen = openedFiles(steps)
  for (const step of steps) {
    if (step.kind !== "shell") continue
    const command = commandOf(step)
    for (const token of command.split(/[^\w./\\:@-]+/)) {
      if (!token || !/[./\\]/.test(token)) continue
      seen.add(normalizePath(token.replace(/^['"`(]+|['"`),]+$/g, "")))
    }
  }
  return seen
}

export function wasOpened(docPath, opened) {
  const doc = normalizePath(docPath)
  for (const openedPath of opened) {
    if (openedPath === doc) return true
    if (openedPath.endsWith(`/${doc}`)) return true
  }
  return false
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Word-boundary-safe matcher: "npm install" must not match inside "pnpm install".
 * Tokens that start or end with punctuation are matched literally.
 */
export function tokenMatcher(token) {
  const value = String(token).toLowerCase()
  const lead = /^[\w]/.test(value) ? "(?<![\\w-])" : ""
  const tail = /[\w]$/.test(value) ? "(?![\\w-])" : ""
  return new RegExp(`${lead}${escapeRegExp(value)}${tail}`)
}

function firstMatchingLine(lines, matcher) {
  for (let index = 0; index < lines.length; index += 1) {
    if (matcher.test(lines[index].toLowerCase())) {
      const text = lines[index].trim()
      return {
        line: index + 1,
        text: text.length > 160 ? `${text.slice(0, 159)}…` : text,
      }
    }
  }
  return null
}

/**
 * For every failure, list repo files that mention the same evidence and were
 * never opened in the session. Files the agent did open are excluded on purpose:
 * if the agent read the file and still failed, the document is wrong, not missing.
 *
 * A file qualifies only on structural evidence — the same path, file name, error
 * code or command. Shared prose ("Time range") is not evidence; it was the main
 * source of false positives on real sessions.
 */
export function findGaps(failures, docs, opened, { minScore = 4, top = 3 } = {}) {
  const cache = new Map()
  const FILE_EXT = /\.(mjs|cjs|jsx?|tsx?|json|jsonc|ya?ml|toml|md|mdx|sh|bash|py|go|rs|java|rb|php|env|lock|txt|ini|cfg|conf)$/i
  // A finding needs one token that is structural: the same file name or the same
  // error code. Shared commands and API routes never qualify — in a real session
  // they matched `.github/workflows/ci.yml` for every failing test.
  const qualifies = (token) => {
    if (token.weight < 3) return false
    if (token.type === "path" || token.type === "file") return FILE_EXT.test(token.text)
    if (token.type !== "code") return false
    const code = token.text.toUpperCase()
    if (ERROR_CODE_SET.has(code)) return true
    if (code.includes("_") || /\d/.test(code)) return true
    return code.length >= 12 && !STOP_CODE_SET.has(code)
  }
  const lowerContent = (doc) => {
    if (!cache.has(doc.path)) cache.set(doc.path, doc.content.toLowerCase())
    return cache.get(doc.path)
  }

  return failures.map((failure) => {
    const gaps = []
    for (const doc of docs) {
      if (wasOpened(doc.path, opened)) continue
      const content = lowerContent(doc)
      const matched = []
      let score = 0
      let hit = null
      for (const token of failure.evidence) {
        const needle = token.text.toLowerCase()
        if (!needle) continue
        const matcher = tokenMatcher(needle)
        if (!matcher.test(content)) continue
        matched.push({ text: token.text, weight: token.weight, type: token.type })
        score += qualifies(token) ? token.weight : 0
        if (!hit) hit = firstMatchingLine(doc.lines, matcher)
      }
      if (score < minScore) continue
      if (!matched.some(qualifies)) continue
      gaps.push({
        file: doc.path,
        line: hit?.line ?? null,
        text: hit?.text ?? "",
        score,
        matched: matched.map((token) => token.text),
      })
    }
    gaps.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    return {
      ...failure,
      gaps: gaps.slice(0, top),
      avoidable: gaps.length > 0,
      totalFiles: gaps.length,
    }
  })
}
