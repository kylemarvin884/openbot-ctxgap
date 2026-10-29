# ctxgap

**你的 agent 失败的那几个 turn，仓库里可能本来就有答案 —— 只是这次会话从没打开过那个文件。**

`ctxgap` 读一份 coding agent 的会话 JSONL，找出所有失败的 tool call，然后去仓库里搜：
哪个文本文件提到了这个错误、这个命令、这个路径，而且**本次会话里 agent 没有读过它**。

输出是给人看的「补哪条 context」，不是「你的会话有多糟」。

```
$ node src/cli.mjs analyze demo/session.jsonl --repo demo/repo
```

## 安装

需要 Node >= 22。没有依赖，不需要 `npm install`。

```bash
git clone https://github.com/kylemarvin884/openbot-ctxgap
cd openbot-ctxgap
node src/cli.mjs analyze <session.jsonl> --repo <repo-dir>
```

或者：

```bash
node --test        # 跑测试
node demo/demo.mjs # 跑仓库自带的可复现 demo
```

## 真实输出

`demo/session.jsonl` 是 3 个失败 turn 的会话（`npm install` 在 pnpm 仓库里失败、
缺少 `API_BASE`、读了一个已删除的文件），`demo/repo` 是那个仓库：

```text
ctxgap 0.1.0 — demo/session.jsonl (12 steps) — repo demo/repo

3 failed steps · 2 with unread evidence · 2 unread files

turn 3  Bash  exit != 0
  ran     npm install
  failed  npm ERR! code EUNSUPPORTEDPROTOCOL
  never opened
    CONTRIBUTING.md:6  "npm 不支持，会直接报 EUNSUPPORTEDPROTOCOL。"
      matched: EUNSUPPORTEDPROTOCOL, npm install, workspace:

turn 6  Bash  exit != 0
  ran     node scripts/deploy.mjs
  failed  Error: MISSING_API_BASE
  never opened
    docs/deploy.md:4  "`MISSING_API_BASE` 并退出："
      matched: MISSING_API_BASE, scripts/deploy.mjs

turn 9  Read  is_error  (not avoidable)
  path    src/legacy/config.ts
  failed  ENOENT: no such file or directory, open 'src/legacy/config.ts'
  no unread file mentions this — context gap is not the cause

5 files scanned
```

`--json` 输出同样的结构；`--fail-on-gaps` 在有「可避免失败」时退出码 1，可以直接进 CI。

## 它怎么判断

1. **解析会话**：支持 Claude Code（`~/.claude/projects/**/*.jsonl`）、Codex
   （`~/.codex/sessions/**/*.jsonl`，含 `function_call` 和 `custom_tool_call`）和一种通用
   JSONL（见下）。
2. **找失败**：`is_error: true`、`Process exited with code 1`、`npm ERR!`、`Error:` 开头等。
3. **提证据**：只从**报错内容**里抽，不从 agent 敲的命令里抽（命令里全是它已经知道的文件名）。
   抽三类：带扩展名的文件路径、错误码 / 环境变量名、命令本身（只用于展示）。
4. **排除已读**：本次会话里被 Read / Edit / Write 碰过的文件不算「没打开过」；shell 命令里
   出现过的文件也保守排除 —— 宁可漏报，不把读过的文件当成没读。
5. **扫仓库**：只扫文本文件（< 256KB），跳过 `.git` / `node_modules` / `dist` / `build` /
   `.venv` / `site-packages` / 二进制；仓库是 git 仓库时**只用 git 跟踪的文件**，
   这样 `.codex-work/`、构建副本、缓存目录不会被当成「仓库知识」。
6. **打分**：文件路径 4 分、错误码 3–4 分、命令 3 分、普通片段 1 分。
   只有路径 / 文件名 / 错误码能构成证据，命令和 API 路由（`/api/user/sessions`）不算；
   总分 ≥4 才报。

## 在真实会话上跑过什么

2026-10-30 在本机 10 份 Codex 会话上试过（都没有上传，全部本地跑）：

- 7 份没有失败的 tool call，输出「没有可检查的失败」。
- 1 份 130 个失败 turn 的长会话，报出 8 条「未读文件」候选。
- 剩下 2 份共 5 个失败，0 条候选。

假阳性确实存在：报出的候选里有一部分只是文件里出现了同一个错误码，和这次失败没有关系。
`ctxgap` 给的是**待核对的候选**，不是结论。这也是默认阈值定在 4 分、命令不算证据的原因 ——
调参过程写在 `data/research/ctxgap.md`。

## 3 个真实用例

**1. monorepo 包管理器不一致**

agent 在你的 pnpm 仓库里跑 `npm install`，报 `EUNSUPPORTEDPROTOCOL`。多数工具只告诉你
「这个 turn 失败了」；`ctxgap` 指出 `CONTRIBUTING.md` 写了要用 pnpm，而这次会话从没读它 ——
修法是往 `AGENTS.md` 加一行指针，不是再写一份文档。

**2. 内部服务地址猜错**

`scripts/deploy.mjs` 抛 `MISSING_API_BASE`。`docs/deploy.md` 里写着 staging 的地址，
但那篇文档没被加载。下次会话照样猜，`ctxgap` 让这一条变成 `AGENTS.md` 的一句话。

**3. 读了已删除的文件**

agent 去读 `src/legacy/config.ts`，文件早就删了。仓库里没有任何文件提到它 ——
`ctxgap` 明确说「这条不是 context 缺失」，不制造假阳性。这种情况该修的是 agent 的
文件清单或 `AGENTS.md` 里的旧路径，而不是补文档。

## 通用输入格式

不是 Claude Code / Codex 也能用，一行一个事件：

```jsonl
{"type":"tool_call","id":"c1","tool":"Bash","input":{"command":"npm install"}}
{"type":"tool_result","id":"c1","is_error":true,"output":"npm ERR! code ENOENT"}
```

## 限制

- 只做字符串匹配，不做语义检索。报错和文档用词完全不同时抓不到。
- 只看 Read / Edit / Write 和 shell 命令里出现过的路径判断「读过」。用 `grep` 看到的内容
  不算读过 —— 保守选择，会漏报但不会把读过的文件当成没读。
- 误报存在：同一个错误码出现在无关文档里也会命中。默认阈值 4 分压掉了一部分，不是全部。
- 不做因果证明。命中只说明「这个文件提到了同样的东西且没被打开」，不保证读了就不失败。
- 不自动改 `AGENTS.md`。

## License

MIT
