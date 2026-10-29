import { commandOf, pathOf } from "./parse.mjs"

const ANSI = /\u001b\[[0-9;]*m/g

const ERROR_PHRASES = [
  "command not found",
  "no such file or directory",
  "cannot find module",
  "module not found",
  "permission denied",
  "missing script",
  "unknown option",
  "is not a function",
  "requires node",
  "not a git repository",
]

const ERROR_CODES = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "EEXIST",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "MODULE_NOT_FOUND",
  "ERR_MODULE_NOT_FOUND",
])

const STOP_CODES = new Set([
  "ERROR",
  "ERRORS",
  "FATAL",
  "FAILED",
  "FAIL",
  "TESTS",
  "TEST",
  "TRUE",
  "FALSE",
  "NULL",
  "JSON",
  "HTML",
  "HTTPS",
  "UTF",
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
  "SUCCESS",
  "DEBUG",
  "WARN",
  "INFO",
  "TODO",
  // License and SQL boilerplate sits in every vendored text file.
  "MERCHANTABILITY",
  "PARTICULAR",
  "FITNESS",
  "PURPOSE",
  "WARRANTY",
  "WITHOUT",
  "COPYRIGHT",
  "LIABILITY",
  "DAMAGES",
  "AUTHORS",
  "SELECT",
  "INSERT",
  "UPDATE",
  "VALUES",
  "WHERE",
  "LIMIT",
  "ORDER",
  "DEPENDENCIES",
])

export const ERROR_CODE_SET = ERROR_CODES
export const STOP_CODE_SET = STOP_CODES

const FAILURE_LINE =
  /(^|\n)\s*(?:error\b|error:|npm ERR!|fatal:|panic:|traceback\b|FAIL\b|TypeError:|ReferenceError:|SyntaxError:)/i
const EXIT_CODE = /\b(?:exit code|exited with code|process exited with code)\s*:?\s*[1-9]\d*/i
const CRASH_PHRASE =
  /\b(?:command not found|no such file or directory|cannot find module|permission denied|MODULE_NOT_FOUND|ENOENT)\b/i

export function clean(text) {
  return String(text ?? "").replace(ANSI, "").replace(/\r/g, "")
}

/** Decide whether a step's result counts as a failure. */
export function isFailure(step) {
  if (!step?.hasResult) return false
  if (step.isError) return true
  const text = clean(step.output)
  if (!text) return false
  if (EXIT_CODE.test(text)) return true
  if (FAILURE_LINE.test(text)) return true
  if (CRASH_PHRASE.test(text)) return true
  return false
}

/** Free-form subject of the step, used in the report header. */
export function subjectOf(step) {
  const raw = step.kind === "shell" ? commandOf(step) : pathOf(step) || step.tool
  const firstLine = String(raw ?? "").split(/\r?\n/)[0].trim()
  if (firstLine.length > 100) return `${firstLine.slice(0, 99)}…`
  return firstLine
}

export function shortError(step, limit = 120) {
  const text = clean(step.output)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const line =
    text.find((entry) => FAILURE_LINE.test(entry) || EXIT_CODE.test(entry) || CRASH_PHRASE.test(entry)) ??
    text[0] ??
    ""
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

function pushToken(map, text, weight, type) {
  const value = String(text ?? "").trim()
  if (value.length < 3 || value.length > 200) return
  if (/^(https?|file|node)$/i.test(value)) return
  const key = value.toLowerCase()
  // Drop tokens that are covered by a token we already have (and vice versa),
  // so "MISSING_API_BASE" does not also report "API_BASE".
  for (const [existingKey, existing] of map) {
    if (existingKey === key) {
      if (existing.weight < weight) map.set(key, { text: value, weight, type })
      return
    }
    if (existingKey.includes(key) && existing.weight >= weight) return
    if (key.includes(existingKey)) {
      if (weight >= existing.weight) map.delete(existingKey)
      else return
    }
  }
  map.set(key, { text: value, weight, type })
}

/**
 * Evidence tokens pulled from the failed command and the error text.
 * Weight is what a match in a repo file is worth: paths and error codes are
 * strong evidence, generic phrases are weak.
 */
export function extractEvidence(step) {
  const map = new Map()
  const command = clean(commandOf(step))
  // Evidence comes from what failed, not from what the agent asked for: the
  // command text is full of file names the agent already knows about.
  const error = clean(step.output).slice(0, 4000)
  const combined = error

  for (const phrase of ERROR_PHRASES) {
    if (combined.toLowerCase().includes(phrase)) pushToken(map, phrase, 2, "phrase")
  }
  for (const code of ERROR_CODES) {
    if (new RegExp(`\\b${code}\\b`).test(combined)) pushToken(map, code, 3, "code")
  }
  for (const match of combined.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) {
    pushToken(map, match[0], match[0].length >= 10 ? 4 : 3, "code")
  }
  for (const match of combined.matchAll(/\b[A-Z][A-Z0-9]{4,}\b/g)) {
    if (STOP_CODES.has(match[0])) continue
    pushToken(map, match[0], match[0].length >= 10 ? 4 : 3, "code")
  }

  const quoted = combined.matchAll(/['"`]([^'"`\n]{3,160})['"`]/g)
  for (const match of quoted) {
    const value = match[1].trim()
    // Only phrases, paths and file names are strong evidence. Bare identifiers
    // ("sha256", "file_size_bytes") appear in every JSON patch and prove nothing.
    const strong = /\s/.test(value) || /[/\\]/.test(value) || /\.[a-z0-9]{2,5}$/i.test(value)
    pushToken(map, value, strong && value.length >= 8 ? 3 : 1, "quoted")
  }

  const withSlash = combined.matchAll(/(?:\.{0,2}\/)?[\w.@+-]+(?:\/[\w.@+-]+)+/g)
  for (const match of withSlash) {
    const value = match[0]
    if (value.length < 3 || value.includes("://")) continue
    // "1/1" and other ratios are not evidence.
    if (!/[a-z]/i.test(value)) continue
    // Hostnames and API routes ("www.gnu.org/licenses", "api/user/sessions")
    // are not files; they matched half the docs in a real session.
    if (/\.(com|org|net|io|dev|ai|co|cn|gov|edu|sh)(\/|$)/i.test(value)) {
      if (!/\.[a-z0-9]{1,5}$/i.test(value.split("/").pop() ?? "")) continue
    }
    const segments = value.split("/").filter(Boolean)
    const hasExtension = /\.[a-z0-9]{1,6}$/i.test(segments.at(-1) ?? "")
    const hasLongSegment = segments.some((segment) => segment.length >= 6)
    if (!hasExtension && !hasLongSegment && segments.length < 3) continue
    pushToken(map, value, 4, "path")
  }

  for (const match of combined.matchAll(/\b[\w-]+\.(?:mjs|cjs|jsx?|tsx?|json|ya?ml|toml|md|sh|py|go|rs|java|rb|php|env)\b/g)) {
    pushToken(map, match[0], 3, "file")
  }

  const direct = pathOf(step)
  if (direct) pushToken(map, direct, 4, "path")

  if (command) {
    const words = command.split(/\s+/).filter((word) => !word.startsWith("-"))
    if (words.length >= 2) pushToken(map, `${words[0]} ${words[1]}`, 3, "command")
    else if (words.length === 1) pushToken(map, words[0], 2, "command")
  }

  return [...map.values()].sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text))
}

/** All steps that failed, with their evidence tokens. */
export function findFailures(steps) {
  return steps
    .filter(isFailure)
    .map((step) => ({
      turn: step.turn,
      tool: step.tool,
      kind: step.kind,
      subject: subjectOf(step),
      error: shortError(step),
      evidence: extractEvidence(step),
    }))
}
