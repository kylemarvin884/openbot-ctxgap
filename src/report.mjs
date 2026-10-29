const VERSION = "0.1.0"

function pad(value, width) {
  return String(value).padEnd(width, " ")
}

export function summarize(results, extras = {}) {
  const failures = results.length
  const avoidable = results.filter((result) => result.avoidable).length
  const files = new Set()
  for (const result of results) {
    for (const gap of result.gaps) files.add(gap.file)
  }
  return {
    failures,
    avoidable,
    withoutEvidence: failures - avoidable,
    unreadFiles: files.size,
    steps: extras.steps ?? 0,
    ignored: extras.ignored ?? 0,
    badLines: extras.badLines ?? 0,
  }
}

export function renderMarkdown({ session, repo, results, stats }) {
  const lines = []
  const summary = summarize(results, stats)
  lines.push(
    `ctxgap ${VERSION} — ${session} (${summary.steps} steps) — repo ${repo}`,
  )
  lines.push("")
  lines.push(
    `${summary.failures} failed steps · ${summary.avoidable} with unread evidence · ${summary.unreadFiles} unread files`,
  )
  lines.push("")

  if (summary.failures === 0) {
    lines.push("No failed tool calls in this session. Nothing to check.")
  }

  for (const result of results) {
    const turn = result.turn == null ? "?" : result.turn
    const status = result.avoidable ? "" : "  (not avoidable)"
    lines.push(`turn ${turn}  ${result.tool}  ${result.kind === "shell" ? "exit != 0" : "is_error"}${status}`)
    const subjectLabel = result.kind === "shell" ? "ran" : result.kind === "read" || result.kind === "edit" ? "path" : "tool"
    if (result.subject) lines.push(`  ${pad(subjectLabel, 8)}${result.subject}`)
    if (result.error) lines.push(`  ${pad("failed", 8)}${result.error}`)
    if (result.avoidable) {
      lines.push("  never opened")
      for (const gap of result.gaps) {
        const where = gap.line ? `${gap.file}:${gap.line}` : gap.file
        lines.push(`    ${where}  "${gap.text}"`)
        lines.push(`      matched: ${gap.matched.join(", ")}`)
      }
    } else {
      lines.push("  no unread file mentions this — context gap is not the cause")
    }
    lines.push("")
  }

  if (summary.ignored > 0 || summary.badLines > 0 || stats.files != null) {
    const parts = []
    if (stats.files != null) {
      parts.push(`${stats.files} files scanned${stats.tracked ? " (git-tracked)" : ""}`)
    }
    if (summary.ignored > 0) parts.push(`${summary.ignored} ignored (binary / too large)`)
    if (summary.badLines > 0) parts.push(`${summary.badLines} unreadable lines`)
    lines.push(parts.join(" · "))
  }

  return `${lines.join("\n").trimEnd()}\n`
}

export function renderJson({ session, repo, results, stats }) {
  return JSON.stringify(
    {
      version: VERSION,
      session,
      repo,
      summary: summarize(results, stats),
      failures: results,
    },
    null,
    2,
  )
}
