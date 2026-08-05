# Letta Plannotator Mod

A Letta Code mod that turns the local [Plannotator](https://github.com/backnotprop/plannotator) CLI into three agent-callable review tools.

The mod keeps the boundary simple: Letta starts Plannotator only after ordinary tool approval, Plannotator opens its local browser UI, and the submitted decision or feedback returns to the active Letta conversation.

## Tools

| Tool | Purpose |
| --- | --- |
| `plannotator_annotate` | Annotate a file, folder, HTML document, plain-text document, or HTTP(S) URL. Supports Plannotator approval gates. |
| `plannotator_review` | Review local VCS changes or a GitHub pull request / GitLab merge request URL. |
| `plannotator_annotate_last` | Annotate the latest rendered assistant response from the active Letta conversation. |

The third tool is Letta-specific. It reads the current conversation through the mod API and sends only rendered assistant text to `plannotator annotate-last --stdin`; it does not ask Plannotator to inspect Claude Code or Codex session logs.

## Requirements

- Letta Code with mod tools. This repository was developed and validated with Letta Code 0.30.6.
- Plannotator 0.23.1 or a later version compatible with its `--json` decision format.
- Plannotator installed on every computer where the tools will run.

Verify Plannotator first:

```bash
plannotator --version
plannotator --help
```

On Windows PowerShell:

```powershell
plannotator --version
plannotator --help
```

## Recommended: agent-scoped installation

Agent-scoped mods live in the agent's git-backed memory and follow that agent between computers. This is the recommended installation for Johnny5.

The source file must be committed inside MemFS before it can sync to another computer.

### macOS or Linux

From this repository:

```bash
mkdir -p "$MEMORY_DIR/mods"
cp src/plannotator.ts "$MEMORY_DIR/mods/plannotator.ts"

git -C "$MEMORY_DIR" add mods/plannotator.ts
git -C "$MEMORY_DIR" commit -m 'feat: add Plannotator mod'
```

Confirm Letta sees the agent mod:

```bash
letta mods list --agent "$AGENT_ID"
```

### Windows PowerShell

From this repository:

```powershell
New-Item -ItemType Directory -Force "$env:MEMORY_DIR\mods" | Out-Null
Copy-Item ".\src\plannotator.ts" "$env:MEMORY_DIR\mods\plannotator.ts" -Force

git -C $env:MEMORY_DIR add mods/plannotator.ts
git -C $env:MEMORY_DIR commit -m "feat: add Plannotator mod"
```

Confirm Letta sees the agent mod:

```powershell
letta mods list --agent $env:AGENT_ID
```

If you ask a Letta agent to perform the installation, it should use the correct agent authorship when committing the MemFS change.

## Optional: computer-scoped installation

Use this when the mod should be available to every local Letta agent but should not travel with one agent.

### macOS or Linux

```bash
mkdir -p ~/.letta/mods
cp src/plannotator.ts ~/.letta/mods/plannotator.ts
```

### Windows PowerShell

```powershell
New-Item -ItemType Directory -Force "$HOME\.letta\mods" | Out-Null
Copy-Item ".\src\plannotator.ts" "$HOME\.letta\mods\plannotator.ts" -Force
```

Computer-scoped files do not need a MemFS git commit, but they must be installed separately on every computer.

## Reload Letta Code

After installing or updating the mod, run this inside Letta Code:

```text
/reload
```

The three tools become available on the next model turn. If a mod prevents normal startup, launch Letta without mods:

```bash
letta --no-mods
```

or:

```bash
LETTA_DISABLE_MODS=1 letta
```

## Executable lookup

By default the mod runs `plannotator` through the Letta process's `PATH` with `shell: false`.

For Desktop sessions, services, or machines whose GUI environment does not inherit your terminal `PATH`, set `PLANNOTATOR_BIN` to the absolute executable path before starting Letta. An absolute override also avoids selecting an unintended executable from an untrusted `PATH` directory.

macOS example:

```bash
PLANNOTATOR_BIN="$HOME/.local/bin/plannotator" letta
```

Windows PowerShell example:

```powershell
$env:PLANNOTATOR_BIN = "C:\absolute\path\to\plannotator.exe"
letta
```

`PLANNOTATOR_BIN` is computer-specific and should not be stored in the agent-scoped mod file. Relative overrides are rejected.

## Usage

Natural-language requests are enough:

```text
Open README.md in Plannotator and act on my annotations.
```

```text
Review the current diff with Plannotator.
```

```text
Open https://github.com/example/repo/pull/42 in Plannotator.
```

```text
Put your last response in Plannotator so I can mark it up.
```

```text
Gate SPEC.md in Plannotator before implementing it.
```

All three tools require ordinary Letta tool approval and are intentionally marked non-parallel-safe. They should be called only when the user explicitly requests Plannotator.

## Where the browser opens

Plannotator runs on the computer executing the Letta tool, and its browser opens there.

- Local Letta CLI or Desktop session: browser opens on that local computer.
- Remote/BYOM session: browser opens on the selected execution computer.
- Cloud sandbox or unattended channel listener: the browser may open somewhere you cannot use it. Do not invoke these tools there unless remote Plannotator access has been deliberately configured.

An agent-scoped mod follows Johnny5 between the Mac and Windows machines, but the Plannotator executable and `PLANNOTATOR_BIN`/`PATH` configuration remain local to each machine.

## Safety behavior

- User values are passed as process arguments with `shell: false`; they are never interpolated into a shell command.
- Annotation targets beginning with `-` are rejected to prevent CLI option injection. Use `./-filename` or an absolute path for a legitimate filename beginning with a hyphen.
- Each captured stdout/stderr stream is limited to 1 MiB.
- Annotate-last input is limited to 1 MiB of UTF-8.
- Completed-process stderr included in an error is bounded.
- Cancellation closes stdin, requests process termination, and escalates after a short grace period.
- The mod does not install automatic stop hooks, intercept plans, edit reviewed files, or execute work merely because a plan was approved.

Path and URL access is intentionally broad after tool approval because Plannotator itself supports absolute files, folders, and URLs. Review the tool arguments before approving a call.

Normal direct-child execution is designed for macOS, Linux, and Windows. The automated process-lifecycle suite currently runs on macOS; native Windows cancellation and descendant-process behavior should be smoke-tested on the Windows machine before relying on cancellation as a process-tree cleanup boundary. A browser tab opened before cancellation may remain open even after the Plannotator CLI exits.

## Troubleshooting

### `plannotator_not_found`

The Letta process cannot find the CLI. Verify `plannotator --version` in the same environment that launches Letta, or set an absolute `PLANNOTATOR_BIN`.

### `invalid_json`

The installed Plannotator returned an incompatible decision record. Check `plannotator --version` and update the CLI. The verified contract is Plannotator 0.23.1.

### Browser session closed / dismissed

Closing the browser without submitting feedback is a valid `dismissed` decision. No feedback is invented.

### Browser opened on the wrong machine

The tool ran on a different execution computer. Reconnect Letta to the computer whose browser you want to use, then invoke the tool again.

### Desktop finds a different PATH than the terminal

Set `PLANNOTATOR_BIN` to the absolute executable path in the environment that launches the Desktop listener or Letta process.

### Mod failed to load

Inspect:

```text
~/.letta/mods/diagnostics/latest.json
```

Then start with `letta --no-mods` if a clean baseline is needed.

## Development

Install development dependencies:

```bash
bun install
```

Run the complete verification gate:

```bash
bun run check
```

That command runs:

1. The Bun test suite.
2. TypeScript typechecking.
3. A Node-targeted single-file build.
4. A Node-compatible ESM activation and cleanup validation.

Useful individual commands:

```bash
bun run test
bun run typecheck
bun run build
bun run validate:mod
```

Repository structure:

```text
SPEC.md                  Product and behavior contract
PLAN.md                  Ordered TDD implementation plan
src/plannotator.ts       Single-file production mod
tests/                   Public-interface and real-process tests
scripts/validate-mod.mjs Node-compatible built-mod validation
```

The generated `dist/` directory is ignored. Install `src/plannotator.ts`, not a development artifact.
