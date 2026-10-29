import { readFile } from "node:fs/promises"

/** Normalize a tool result payload into a plain string. */
export function resultText(output) {
  if (output == null) return ""
  if (typeof output === "string") return output
  if (Array.isArray(output)) return output.map(resultText).filter(Boolean).join("\n")
  if (typeof output === "object") {
    if (typeof output.text === "string") return output.text
    if (typeof output.content === "string") return output.content
    if (output.content) return resultText(output.content)
    const parts = []
    for (const key of ["stdout", "output", "stderr", "message", "error"]) {
      if (typeof output[key] === "string" && output[key]) parts.push(output[key])
    }
    if (parts.length) return parts.join("\n")
    return JSON.stringify(output)
  }
  return String(output)
}

function toCommand(input) {
  if (!input || typeof input !== "object") return ""
  for (const key of ["command", "cmd", "argv"]) {
    const value = input[key]
    if (typeof value === "string") return value
    if (Array.isArray(value)) return value.map(String).join(" ")
  }
  return ""
}

function toPath(input) {
  if (!input || typeof input !== "object") return ""
  for (const key of ["file_path", "path", "file", "notebook_path"]) {
    if (typeof input[key] === "string" && input[key]) return input[key]
  }
  return ""
}

/** Map vendor tool names onto the three behaviours we care about. */
export function toolKind(tool = "") {
  const name = String(tool).toLowerCase()
  if (/bash|shell|exec|terminal|command|run_command|container\.exec/.test(name)) return "shell"
  if (/^(read|read_file|view|notebook_read)$/.test(name)) return "read"
  if (/edit|write|multi_edit|apply_patch|str_replace/.test(name)) return "edit"
  return "other"
}

/** Codex "exec" custom tools wrap shell calls in JS: pull the `cmd:` literals out. */
export function commandsFromScript(source) {
  const found = []
  const pattern = /\bcmd\s*:\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g
  for (const match of String(source ?? "").matchAll(pattern)) {
    const raw = match[1] ?? match[2] ?? ""
    const value = raw.replace(/\\(["'\\])/g, "$1").trim()
    if (value) found.push(value)
  }
  return found.join("\n")
}

export function commandOf(step) {
  return toCommand(step.input) || step.command || ""
}

export function pathOf(step) {
  return toPath(step.input) || step.path || ""
}

/**
 * Parse a session transcript (JSONL) into ordered steps.
 * Every step is one tool call plus, when a matching result exists, its output.
 * Turn numbers are 1-based positions of the call in the session.
 */
export function parseSessionText(text) {
  const lines = String(text).split(/\r?\n/)
  const calls = []
  const pending = new Map()
  const unpaired = []
  const steps = []
  let badLines = 0

  const addCall = (call) => {
    const turn = calls.length + 1
    const step = {
      turn,
      tool: call.tool || "unknown",
      kind: toolKind(call.tool),
      input: call.input ?? {},
      command: toCommand(call.input),
      path: toPath(call.input),
      output: "",
      isError: false,
      hasResult: false,
    }
    calls.push(step)
    steps.push(step)
    if (call.id) pending.set(call.id, step)
    else unpaired.push(step)
    return step
  }

  const addResult = (result) => {
    let step = result.id ? pending.get(result.id) : undefined
    if (!step && unpaired.length) step = unpaired.shift()
    if (!step) {
      step = {
        turn: null,
        tool: result.tool || "unknown",
        kind: toolKind(result.tool),
        input: {},
        command: "",
        path: "",
        output: "",
        isError: false,
        hasResult: false,
      }
      steps.push(step)
    }
    pending.delete(result.id)
    step.output = resultText(result.output)
    step.isError = Boolean(result.isError)
    step.hasResult = true
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      badLines += 1
      continue
    }
    if (!record || typeof record !== "object") {
      badLines += 1
      continue
    }

    // Claude Code: assistant / user records carrying content blocks
    const blocks = record.message?.content
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (!block || typeof block !== "object") continue
        if (block.type === "tool_use") {
          addCall({ id: block.id, tool: block.name, input: block.input })
        } else if (block.type === "tool_result") {
          addResult({
            id: block.tool_use_id,
            output: block.content,
            isError: block.is_error === true || block.isError === true,
          })
        }
      }
      continue
    }

    // Codex: response_item with a payload
    if (record.type === "response_item" && record.payload) {
      const payload = record.payload
      if (payload.type === "function_call") {
        let input = payload.arguments
        if (typeof input === "string") {
          try {
            input = JSON.parse(input)
          } catch {
            input = { command: payload.arguments }
          }
        }
        addCall({ id: payload.call_id, tool: payload.name, input })
      } else if (payload.type === "function_call_output") {
        addResult({ id: payload.call_id, output: payload.output, isError: false })
      } else if (payload.type === "custom_tool_call") {
        const script = typeof payload.input === "string" ? payload.input : ""
        const command = commandsFromScript(script)
        addCall({
          id: payload.call_id,
          tool: payload.name,
          input: command ? { command, script } : { script },
        })
      } else if (payload.type === "custom_tool_call_output") {
        addResult({
          id: payload.call_id,
          output: payload.output,
          isError: payload.status === "failed",
        })
      }
      continue
    }

    // Generic normalized format
    if (record.type === "tool_call" || record.type === "call") {
      addCall({ id: record.id ?? record.call_id, tool: record.tool ?? record.name, input: record.input })
      continue
    }
    if (record.type === "tool_result" || record.type === "result") {
      addResult({
        id: record.id ?? record.call_id,
        tool: record.tool ?? record.name,
        output: record.output ?? record.result,
        isError: record.is_error === true || record.isError === true,
      })
      continue
    }
  }

  const replaced = steps.filter((step) => step.hasResult)
  return {
    steps,
    stats: {
      lines: lines.filter((line) => line.trim()).length,
      badLines,
      calls: calls.length,
      results: replaced.length,
    },
  }
}

export async function parseSessionFile(file) {
  const text = await readFile(file, "utf8")
  return parseSessionText(text)
}
