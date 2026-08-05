# Letta Plannotator Mod Implementation Plan

> Implemented 2026-08-05. The final gate runs public-interface tests, real child-process fixtures, TypeScript typechecking, a Node-targeted build, and Node-compatible mod activation validation through `bun run check`.

This plan implements [SPEC.md](SPEC.md) as a sequence of small vertical slices. Every behavioral task follows one red-green-refactor cycle: add one failing public-interface test, run it to confirm the intended failure, make the smallest implementation pass, then refactor only while the suite is green.

## Public implementation shape

The single production module will export:

- `activate(letta)` as the default Letta mod entry point.
- `createPlannotatorTools(dependencies?)` to construct the three tool definitions for tests and activation.
- `runPlannotator(request, dependencies?)` as the process-boundary adapter.
- `extractLatestAssistantText(history)` for the Letta-aware annotate-last behavior.

The process runner is the only injected external boundary. Tests call public tool handlers with fake Letta contexts and use a fake runner result; they do not mock internal helpers.

## Step 1 — Repository and test harness

1. Add `package.json` with Bun scripts for `test`, `typecheck`, and a combined `check`.
2. Add `tsconfig.json` targeting modern Node-compatible ESM without emitting files.
3. Add `.gitignore` for dependency, coverage, build, and local-editor artifacts.
4. Add an empty production module exporting the planned public names only as needed by the first test.
5. Run the empty test suite and typecheck to prove the harness itself is valid.

Completion signal: Bun can discover tests and TypeScript can load the production module.

## Step 2 — Capability-safe activation

1. RED: Add one test showing activation registers no tools when `letta.capabilities.tools` is false.
2. GREEN: Add the minimal capability guard.
3. RED: Add one test showing activation registers exactly three named tools when tool capability exists.
4. GREEN: Register minimal definitions for `plannotator_annotate`, `plannotator_review`, and `plannotator_annotate_last`.
5. REFACTOR: Centralize tool construction while keeping both tests green.

Completion signal: activation has no startup side effects and the public tool surface is exact.

## Step 3 — Annotate tracer bullet

1. RED: Through the registered `plannotator_annotate` handler, assert that target `plan.md` launches `plannotator` with `annotate plan.md --json`, uses `ctx.cwd`, and returns an approved decision from JSON stdout.
2. GREEN: Implement the minimal annotate handler and injected process call.
3. REFACTOR: Introduce the stable decision parser without changing the public result.

Completion signal: one end-to-end tool call proves registration, argument mapping, cwd propagation, process execution, JSON parsing, and result shaping.

## Step 4 — Annotate options and validation

For each item, add one failing test, make it pass, and rerun all prior tests:

1. `gate: true` adds `--gate` before `--json`.
2. `markdown: true` adds `--markdown`.
3. `no_jina: true` adds `--no-jina`.
4. Combined options have deterministic ordering.
5. Empty or whitespace-only target returns `invalid_arguments` without launching a process.
6. Annotated JSON preserves feedback exactly.
7. Dismissed JSON returns a dismissed decision without invented feedback.

Completion signal: every documented annotate argument and decision is pinned.

## Step 5 — Process and annotation failures

Add one red-green cycle for each externally observable failure:

1. Successful exit with non-JSON stdout returns `invalid_json`.
2. Successful exit with an unknown decision returns `invalid_json`.
3. `ENOENT` / executable launch failure returns `plannotator_not_found`.
4. Nonzero exit returns `plannotator_failed` with bounded stderr.
5. Long stdout or stderr is truncated to the documented bound.

Completion signal: expected CLI failures are recoverable, bounded, and stable.

## Step 6 — Review workflow

1. RED/GREEN: No arguments launch `review` in `ctx.cwd` and return plaintext output.
2. RED/GREEN: `force_git: true` adds `--git`.
3. RED/GREEN: A valid GitHub PR URL is appended as the positional target.
4. RED/GREEN: A valid GitLab MR URL is accepted.
5. RED/GREEN: `local_checkout: true` adds `--local`; false adds `--no-local`.
6. RED/GREEN: `local_checkout` without a URL returns `invalid_arguments` without launching.
7. RED/GREEN: Non-HTTP(S) review URL returns `invalid_arguments`.
8. REFACTOR: Share process-error mapping with annotation without coupling tests to private helpers.

Completion signal: local and remote review contracts are complete.

## Step 7 — Latest assistant text extraction

Exercise `extractLatestAssistantText(history)` through its public export, one case at a time:

1. Select the newest assistant message with a string body.
2. Skip newer tool/user/system messages.
3. Join rendered text blocks from structured assistant content in order without injecting whitespace.
4. Ignore reasoning, tool-call, and non-text blocks.
5. Ignore errored assistant messages and skip empty assistant messages, falling back to the preceding rendered assistant response.
6. Return `null` when no rendered assistant text exists.
7. Refactor content normalization only after all cases are green.

Completion signal: Letta conversation history is converted into exactly the human-visible assistant text Plannotator should display.

## Step 8 — Annotate-last workflow

1. RED: Through the registered handler, show that the newest assistant text is sent to `annotate-last --stdin --json` and not placed in command arguments.
2. GREEN: Read history with `ctx.conversation.getHistory()` and pass stdin to the runner.
3. RED/GREEN: `gate: true` adds `--gate`.
4. RED/GREEN: Missing assistant text returns `no_assistant_message` without launching.
5. RED/GREEN: History-read failure returns a short `plannotator_failed` result rather than leaking a stack trace.

Completion signal: Plannotator reviews the actual Letta response rather than another harness's session logs.

## Step 9 — Real child-process adapter and cancellation

1. RED: Add a fixture executable that records argv, cwd, and stdin and emits an approved decision.
2. GREEN: Implement the Node `spawn` adapter and prove the real process boundary end to end.
3. RED: Add a fixture that waits; abort the invocation and assert the child is terminated and the result is `aborted`.
4. GREEN: Wire `AbortSignal` handling and cleanup.
5. RED/GREEN: Verify abort listeners are removed after normal completion.
6. REFACTOR: Keep process lifecycle logic in one deep function while all tool tests remain green.

Completion signal: the production adapter works without a shell and cancels cleanly.

## Step 10 — Static and mod-load validation

1. Run the full Bun test suite.
2. Run TypeScript typecheck.
3. Load the module in a small fake Letta host and verify the three schemas are object schemas with descriptions and no unknown properties.
4. Verify each tool is non-parallel-safe and uses ordinary approval.
5. Run `letta mods list --agent "$AGENT_ID"` after agent-scoped installation to confirm discovery.

Completion signal: tests, types, schemas, and Letta discovery all pass.

## Step 11 — Installation and user documentation

Write `README.md` only after the behavior is final. Include:

1. What the mod does and what it deliberately does not do.
2. Prerequisites and `plannotator --version` verification.
3. Agent-scoped installation on macOS/Linux.
4. Agent-scoped installation on Windows PowerShell.
5. Optional computer-scoped installation on both platforms.
6. `/reload` and tool-discovery verification.
7. Example natural-language requests for all three tools.
8. Browser/execution-computer boundary for local, Desktop, remote, and cloud sessions.
9. Troubleshooting for missing CLI, PATH differences, dismissed sessions, invalid JSON, and mod diagnostics.
10. Development commands and repository structure.

Completion signal: a user can install and verify the mod on either computer without reading source code.

## Step 12 — Final product verification

1. Run `bun run check` from a clean dependency install.
2. Copy the production file to a temporary fake mods directory and import it successfully.
3. Install the final file into Johnny5's agent-scoped MemFS mod directory.
4. Confirm the installed file matches the repository source by checksum.
5. Inspect repository status for accidental artifacts or secrets.
6. Report the exact changed paths, verification commands, and the required `/reload` step.

Completion signal: the repository is clean, reproducible, installed, and ready for an interactive Plannotator smoke test after reload.
