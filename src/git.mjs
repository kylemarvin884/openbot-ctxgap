import { spawnSync } from "node:child_process"

/**
 * Files git knows about. Scratch directories, build output and agent worktrees
 * inside the repo are usually untracked or ignored — they are not repo knowledge
 * and must not be reported as "a file you forgot to read".
 */
export function trackedFiles(root) {
  const result = spawnSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    return { available: false, files: null, reason: (result.error?.message || result.stderr || "").trim() }
  }
  const files = result.stdout
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, "/"))
  if (!files.length) return { available: false, files: null, reason: "empty git index" }
  return { available: true, files: new Set(files), reason: null }
}
