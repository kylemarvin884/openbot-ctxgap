import test from "node:test"
import assert from "node:assert/strict"

import { commandsFromScript, parseSessionText, resultText, toolKind } from "../src/parse.mjs"

const claudeCode = [
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"a1","name":"Bash","input":{"command":"ls -la"}}]}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"a1","is_error":false,"content":[{"type":"text","text":"README.md"}]}]}}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"a2","name":"Read","input":{"file_path":"package.json"}}]}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"a2","is_error":true,"content":"ENOENT: no such file or directory"}]}}',
].join("\n")

test("parses Claude Code records and pairs results by tool_use_id", () => {
  const { steps, stats } = parseSessionText(claudeCode)
  assert.equal(steps.length, 2)
  assert.equal(stats.badLines, 0)
  assert.equal(steps[0].turn, 1)
  assert.equal(steps[0].tool, "Bash")
  assert.equal(steps[0].kind, "shell")
  assert.equal(steps[0].command, "ls -la")
  assert.equal(steps[0].output, "README.md")
  assert.equal(steps[0].isError, false)
  assert.equal(steps[1].turn, 2)
  assert.equal(steps[1].kind, "read")
  assert.equal(steps[1].path, "package.json")
  assert.equal(steps[1].isError, true)
})

test("parses Codex response_item records with JSON-string arguments", () => {
  const text = [
    '{"type":"response_item","payload":{"type":"function_call","name":"shell","call_id":"c1","arguments":"{\\"command\\":[\\"pnpm\\",\\"test\\"]}"}}',
    '{"type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":"1 test failed"}}',
  ].join("\n")
  const { steps } = parseSessionText(text)
  assert.equal(steps.length, 1)
  assert.equal(steps[0].command, "pnpm test")
  assert.equal(steps[0].output, "1 test failed")
  assert.equal(steps[0].hasResult, true)
})

test("parses Codex custom_tool_call records and pulls cmd literals out of the JS", () => {
  const text = [
    '{"type":"response_item","payload":{"type":"custom_tool_call","name":"exec","call_id":"c9","input":"const r=await tools.exec_command({cmd:\\"Get-Content docs/deploy.md\\",workdir:\\"C:\\\\\\\\repo\\"});"}}',
    '{"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"c9","output":[{"type":"input_text","text":"Process exited with code 1"}]}}',
  ].join("\n")
  const { steps } = parseSessionText(text)
  assert.equal(steps.length, 1)
  assert.equal(steps[0].kind, "shell")
  assert.equal(steps[0].command, "Get-Content docs/deploy.md")
  assert.equal(steps[0].output, "Process exited with code 1")
})

test("commandsFromScript handles single quotes and multiple commands", () => {
  assert.equal(commandsFromScript("tools.exec_command({cmd:'pnpm test'})"), "pnpm test")
  assert.equal(
    commandsFromScript(`a({cmd:"ls"}); b({cmd:'rg foo'})`),
    "ls\nrg foo",
  )
  assert.equal(commandsFromScript("no commands here"), "")
})

test("parses the generic tool_call / tool_result format", () => {
  const text = [
    '{"type":"tool_call","id":"g1","tool":"Read","input":{"path":"docs/deploy.md"}}',
    '{"type":"tool_result","id":"g1","is_error":false,"output":"deploy notes"}',
  ].join("\n")
  const { steps } = parseSessionText(text)
  assert.equal(steps.length, 1)
  assert.equal(steps[0].path, "docs/deploy.md")
  assert.equal(steps[0].output, "deploy notes")
})

test("keeps unmatched results instead of dropping them", () => {
  const text = '{"type":"tool_result","tool":"Bash","is_error":true,"output":"boom"}'
  const { steps } = parseSessionText(text)
  assert.equal(steps.length, 1)
  assert.equal(steps[0].turn, null)
  assert.equal(steps[0].isError, true)
})

test("counts unreadable lines", () => {
  const { stats } = parseSessionText('{"type":"tool_call"}\nnot json\n\n')
  assert.equal(stats.badLines, 1)
})

test("resultText flattens the shapes providers actually emit", () => {
  assert.equal(resultText("plain"), "plain")
  assert.equal(resultText([{ type: "text", text: "a" }, { type: "text", text: "b" }]), "a\nb")
  assert.equal(resultText({ stdout: "out", stderr: "err" }), "out\nerr")
  assert.equal(resultText({ message: "only message" }), "only message")
  assert.equal(resultText(null), "")
})

test("toolKind groups vendor names without guessing too hard", () => {
  assert.equal(toolKind("Bash"), "shell")
  assert.equal(toolKind("run_command"), "shell")
  assert.equal(toolKind("Read"), "read")
  assert.equal(toolKind("read_file"), "read")
  assert.equal(toolKind("MultiEdit"), "edit")
  assert.equal(toolKind("web_search"), "other")
})
