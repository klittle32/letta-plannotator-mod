# Letta Plannotator Mod Specification

## Purpose

Provide Johnny5 and other Letta Code agents with explicit, local, browser-based Plannotator review tools. The integration must preserve Plannotator as the human review surface while making the resulting decision and feedback available to the active Letta conversation.

The mod is a thin adapter. It must not reimplement Plannotator, inspect Plannotator's private storage, or add automatic review hooks.

## Supported environment

- Letta Code with mod tool capability.
- A local `plannotator` executable available on `PATH`.
- macOS, Linux, and Windows.
- Local CLI or Desktop sessions where opening the browser on the execution computer is useful.

The mod is not intended for unattended cloud sandboxes or remote channel listeners unless the operator deliberately runs the tool on a computer whose browser they can access.

When `PLANNOTATOR_BIN` is set, it must be an absolute path and replaces ambient `PATH` lookup. This is the recommended configuration for Desktop/service contexts or machines whose `PATH` may contain untrusted writable directories.

Plannotator 0.23.1 is the minimum verified contract. The mod does not run a version probe; later compatible versions work normally, while incompatible JSON output degrades safely to `invalid_json`.

## Public tools

### `plannotator_annotate`

Open a file, folder, HTML document, plain-text document, or HTTP(S) URL in Plannotator and return the human's decision.

Arguments:

- `target` (required string): Path or HTTP(S) URL accepted by `plannotator annotate`.
- `gate` (optional boolean, default `false`): Show Plannotator's approval control.
- `markdown` (optional boolean, default `false`): Convert HTML input to Markdown.
- `no_jina` (optional boolean, default `false`): Fetch URL content without Jina Reader.

Invocation:

```text
plannotator annotate <target> [--gate] [--markdown] [--no-jina] --json
```

The deterministic argument order is `annotate`, target, `--gate` when requested, `--markdown` when requested, `--no-jina` when requested, then `--json`.

The command runs with the active Letta working directory as its cwd. Relative paths therefore resolve exactly as they would in the user's terminal.

Reject targets beginning with `-` so Plannotator cannot interpret a path as a CLI option. A legitimate local filename beginning with `-` can be supplied as `./-filename` or as an absolute path.

### `plannotator_review`

Open Plannotator's code-review UI for the active repository or a pull request / merge request URL.

Arguments:

- `url` (optional string): GitHub pull request or GitLab merge request URL. Omit it to review local changes in the active working directory.
- `force_git` (optional boolean, default `false`): Pass `--git` to bypass VCS auto-detection.
- `local_checkout` (optional boolean): For URL reviews, pass `--local` when `true` or `--no-local` when `false`. Omit to use Plannotator's default. It is invalid when `url` is omitted.

Invocation:

```text
plannotator review [--git] [--local | --no-local] [url]
```

The deterministic argument order is `review`, `--git` when requested, `--local` or `--no-local` when requested, then the URL. `force_git` is allowed with a URL and passed through for Plannotator to interpret. A provided URL must parse as HTTP(S); Plannotator remains responsible for deciding whether it identifies a supported PR or MR.

The tool returns Plannotator's feedback or approval output as text.

### `plannotator_annotate_last`

Open the most recent rendered assistant text from the active Letta conversation in Plannotator.

Arguments:

- `gate` (optional boolean, default `false`): Show Plannotator's approval control.

Behavior:

1. Read recent conversation history through `ctx.conversation.getHistory({ order: "desc", limit: 100, includeErrors: false })`.
2. Select the first non-error message whose `message_type` is `assistant_message` and which contains rendered text. Do not infer assistant messages from a generic `role` field.
3. Accept a plain string body or structured content arrays. In structured content, include only blocks whose `type` is absent or `text` and whose `text` field is a string. Preserve each original text value and join selected blocks with no injected separator.
4. Ignore top-level tool calls, tool results, reasoning, hidden reasoning, unknown message types, unknown content blocks, errored assistant messages, and empty assistant messages. Skip a message with no selected text and continue to the preceding history item.
5. Send the selected text to Plannotator on stdin.

Invocation:

```text
plannotator annotate-last --stdin [--gate] --json
```

The tool must not ask Plannotator to discover Claude Code, Codex, or other harness session logs.

## Decision result contract

For JSON-producing annotation commands, parse stdout and return a Letta-native mod result whose `content` is one stable JSON record:

```json
{
  "status": "success",
  "content": "{\"decision\":\"approved | annotated | dismissed\",\"feedback\":\"optional feedback text\"}"
}
```

- `approved`: The user explicitly approved the material.
- `annotated`: The user submitted feedback. Preserve feedback exactly.
- `dismissed`: The browser session closed without submitted feedback.

Stdout may contain surrounding whitespace but must decode to exactly one JSON object. `decision` must be one of the three literals above. `feedback`, when present, must be a string; an annotated decision must include it, and an empty annotated feedback string is preserved as `""`. Unknown fields are ignored. Multiple JSON values, arrays, missing decisions, unknown decisions, and invalid feedback types return `invalid_json`.

Plannotator 0.23.1 exits successfully for all three decisions. The mod must determine the outcome from JSON content, never from exit code alone.

Code-review output is currently plaintext and should be returned as:

```json
{
  "status": "success",
  "content": "Plannotator stdout"
}
```

Review stdout is preserved exactly, including an empty string or trailing newline, subject only to the process output limit.

## Error contract

Expected failures return a recoverable tool result rather than an unhandled exception:

```json
{
  "status": "error",
  "content": "{\"code\":\"stable_error_code\",\"message\":\"short actionable message\"}"
}
```

The outer object must use only Letta's supported mod result fields. Decision and error details live inside `content` so they are preserved in the model-visible tool result rather than relying on unknown top-level properties.

Required error cases:

- `plannotator_not_found`: Executable cannot be found or launched.
- `invalid_arguments`: Empty target, invalid review option combination, or malformed URL where a URL is required.
- `no_assistant_message`: No rendered assistant text exists in the available conversation history.
- `invalid_json`: Annotation command completed without a valid decision record.
- `plannotator_failed`: Plannotator exited unsuccessfully; include bounded stderr context.
- `output_limit_exceeded`: Plannotator produced more output than the adapter can safely retain.
- `aborted`: Letta cancelled the tool invocation.

Do not include stack traces, environment dumps, or unbounded CLI output in expected error results.

Only an `ENOENT` launch error maps to `plannotator_not_found`. Permission denial, invalid executable format, and other spawn failures map to `plannotator_failed` with a short actionable message.

## Process and cancellation behavior

- Launch the executable directly with an argument array; never interpolate user input into a shell command.
- Inherit no interactive stdin except when sending the explicit last-message text.
- Capture stdout and stderr separately.
- Cap each captured stream at 1 MiB while the process is running. If either stream exceeds the cap, terminate the child and return `output_limit_exceeded`; do not silently parse or return partial output.
- Cap annotate-last stdin at 1 MiB of UTF-8 before launching Plannotator. Larger rendered responses return `input_limit_exceeded` without starting a child.
- When including stderr in a `plannotator_failed` message, retain at most the first 4,096 Unicode code points and append `… [truncated]` when more was available.
- Do not impose an arbitrary timeout. Human review may take as long as needed.
- Listen to `ctx.signal`. A pre-aborted signal must not launch a child. On cancellation, close stdin, request child termination once, and settle the tool exactly once as `aborted`. If graceful termination has not closed the child after two seconds, request forced termination. Natural exit racing with cancellation must still produce only one result.
- Remove all abort listeners after the child settles.
- Do not launch any process during mod activation.

## Safety and permissions

- Each tool opens a browser and waits for human interaction, so it is not parallel-safe.
- Tool descriptions must say they are for explicit Plannotator review requests. The model should not open Plannotator merely because review might be useful.
- Register every tool with `requiresApproval: true` and do not set `approvalPolicy: "alwaysAsk"`; this uses ordinary configurable Letta tool approval while preserving the browser as the human review boundary.
- Do not close, edit, or overwrite the reviewed target.
- Do not automatically execute implementation work after an approval. Return the decision to the active model, which decides the next conversational step.

## Portability and installation

- Ship as a single TypeScript mod file with no third-party runtime dependencies.
- The same file must load on macOS, Linux, and Windows.
- The preferred installation is agent-scoped at `$MEMORY_DIR/mods/plannotator.ts` so it follows Johnny5 between computers.
- A computer-scoped installation at `~/.letta/mods/plannotator.ts` must also be documented.
- If Plannotator is absent on a computer, activation still succeeds; tool calls return `plannotator_not_found`.

Every tool schema must be an object schema with descriptions, explicit required fields, and `additionalProperties: false`. Optional booleans are omitted to select defaults; JSON Schema defaults are descriptive only and must not be required from the caller.

Activation must collect all three tool-registration disposers and return one idempotent cleanup function. Reload cleanup calls every registration disposer exactly once and never launches Plannotator.

## Out of scope

- Automatic plan-mode, stop-hook, or post-tool interception.
- A custom Letta panel or embedded browser.
- Plannotator installation or updates.
- Plannotator archive, session browser, or compound-analysis wrappers.
- Remote-browser tunneling or Plannotator sharing configuration.
- Reimplementation of Plannotator's UI or decision storage.

## Acceptance criteria

1. The mod registers exactly the three specified tools when tool capability is available.
2. No tools are registered when the host lacks tool capability.
3. Activation returns an idempotent disposer that invokes each registration disposer exactly once.
4. Annotate arguments map to the exact CLI argument array and use the active cwd.
5. Review arguments map to the exact CLI argument array and reject invalid combinations.
6. Annotation JSON is parsed into the stable decision contract and invalid shapes fail safely.
7. The newest rendered assistant text is selected under the defined string/multipart contract and sent through stdin for annotate-last.
8. Missing assistant text returns `no_assistant_message` without launching Plannotator.
9. Missing executable, other launch failures, nonzero exit, output overflow, and cancellation return their specified error contracts.
10. Tool output and errors are bounded under the explicit limits.
11. Registered schemas are strict object schemas and all tools use `requiresApproval: true`, are not parallel-safe, and omit `alwaysAsk`.
12. Tests exercise behavior through exported public functions and the registered tool handlers, with the process boundary replaced by a fake executable or injected runner.
13. The repository documents agent-scoped and computer-scoped installation on macOS/Linux and Windows.
14. The complete test suite, typecheck, and mod-load validation pass.
