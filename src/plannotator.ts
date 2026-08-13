import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";

export type Disposable = () => void;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  parallelSafe: boolean;
  run(context: ToolContext): Promise<ModToolResult>;
}

export interface ToolContext {
  args: Record<string, unknown>;
  cwd: string;
  signal: AbortSignal;
  conversation?: {
    getHistory(options?: Record<string, unknown>): Promise<unknown[]>;
  };
}

export interface PlannotatorRunRequest {
  args: string[];
  cwd: string;
  signal: AbortSignal;
  stdin?: string;
}

export interface PlannotatorRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type PlannotatorRunner = (request: PlannotatorRunRequest) => Promise<PlannotatorRunResult>;

export interface PlannotatorDependencies {
  runner?: PlannotatorRunner;
}

export interface PlannotatorProcessDependencies {
  executable?: string;
  prefixArgs?: string[];
  terminationGraceMs?: number;
}

export type ModToolResult = {
  status: "success" | "error";
  content: string;
};

type ToolErrorResult = ModToolResult & { status: "error" };

export interface LettaHost {
  capabilities?: {
    tools?: boolean;
  };
  tools: {
    register(definition: unknown): Disposable;
  };
}

export async function runPlannotator(
  request: PlannotatorRunRequest,
  dependencies: PlannotatorProcessDependencies = {},
): Promise<PlannotatorRunResult> {
  const abortError = () => Object.assign(new Error("Plannotator invocation was aborted"), { code: "ABORT_ERR" });
  const outputLimitError = () =>
    Object.assign(new Error("Plannotator output exceeded the 1 MiB capture limit"), {
      code: "OUTPUT_LIMIT_EXCEEDED",
    });
  if (request.signal.aborted) throw abortError();
  const configuredExecutable = process.env.PLANNOTATOR_BIN?.trim();
  if (dependencies.executable === undefined && configuredExecutable && !isAbsolute(configuredExecutable)) {
    throw Object.assign(new Error("PLANNOTATOR_BIN must be an absolute path"), { code: "INVALID_EXECUTABLE" });
  }
  const executable = dependencies.executable ?? configuredExecutable ?? "plannotator";
  const args = [...(dependencies.prefixArgs ?? []), ...request.args];
  const terminationGraceMs = dependencies.terminationGraceMs ?? 2_000;

  return await new Promise<PlannotatorRunResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: request.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let terminationReason: "aborted" | "output_limit" | null = null;
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      request.signal.removeEventListener("abort", onAbort);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };

    const requestTermination = (reason: "aborted" | "output_limit") => {
      if (settled || terminationReason !== null) return;
      terminationReason = reason;
      child.stdin.destroy();
      child.kill();
      forceKillTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, terminationGraceMs);
      forceKillTimer.unref?.();
    };

    const onAbort = () => requestTermination("aborted");

    const capture = (destination: Buffer[], chunk: Buffer | string, stream: "stdout" | "stderr") => {
      const buffer = Buffer.from(chunk);
      const nextSize = (stream === "stdout" ? stdoutBytes : stderrBytes) + buffer.byteLength;
      if (nextSize > 1024 * 1024) {
        requestTermination("output_limit");
        return;
      }
      if (stream === "stdout") stdoutBytes = nextSize;
      else stderrBytes = nextSize;
      destination.push(buffer);
    };

    child.stdout.on("data", (chunk: Buffer | string) => capture(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer | string) => capture(stderr, chunk, "stderr"));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (terminationReason === "aborted") reject(abortError());
      else if (terminationReason === "output_limit") reject(outputLimitError());
      else reject(error);
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (terminationReason === "aborted") {
        reject(abortError());
        return;
      }
      if (terminationReason === "output_limit") {
        reject(outputLimitError());
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: exitCode ?? 1,
      });
    });

    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) onAbort();
    if (terminationReason === null) child.stdin.end(request.stdin);
  });
}

function successResult(payload: unknown): ModToolResult {
  return { status: "success", content: JSON.stringify(payload) };
}

function successText(content: string): ModToolResult {
  return { status: "success", content };
}

function toolError(code: string, message: string): ToolErrorResult {
  return { status: "error", content: JSON.stringify({ code, message }) };
}

const INVALID_JSON_RESULT = toolError("invalid_json", "Plannotator returned an invalid decision.");
const INVALID_GOAL_JSON_RESULT = toolError(
  "invalid_json",
  "Plannotator returned invalid goal-setup JSON.",
);

function parseDecision(stdout: string): ModToolResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return INVALID_JSON_RESULT;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return INVALID_JSON_RESULT;
  const decision = parsed as { decision?: unknown; feedback?: unknown };
  if (decision.feedback !== undefined && typeof decision.feedback !== "string") return INVALID_JSON_RESULT;
  if (decision.decision === "approved" || decision.decision === "dismissed") {
    return successResult({
      decision: decision.decision,
      ...(typeof decision.feedback === "string" ? { feedback: decision.feedback } : {}),
    });
  }
  if (decision.decision === "annotated" && typeof decision.feedback === "string") {
    return successResult({ decision: "annotated", feedback: decision.feedback });
  }
  return INVALID_JSON_RESULT;
}

function parseGoalSetupResult(stdout: string): ModToolResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return INVALID_GOAL_JSON_RESULT;
  }
  if (!isRecord(parsed) || Array.isArray(parsed)) return INVALID_GOAL_JSON_RESULT;
  return successText(stdout);
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

async function invokeRunner(
  runner: PlannotatorRunner,
  request: PlannotatorRunRequest,
): Promise<PlannotatorRunResult | ToolErrorResult> {
  try {
    return await runner(request);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return toolError("plannotator_not_found", "plannotator was not found on PATH");
    }
    if (errorCode(error) === "OUTPUT_LIMIT_EXCEEDED") {
      return toolError("output_limit_exceeded", "Plannotator output exceeded the 1 MiB capture limit");
    }
    if (errorCode(error) === "ABORT_ERR") {
      return toolError("aborted", "Plannotator invocation was aborted");
    }
    return toolError(
      "plannotator_failed",
      `Unable to run Plannotator: ${boundedStderr(error instanceof Error ? error.message : String(error))}`,
    );
  }
}

function boundedStderr(stderr: string): string {
  const codePoints = Array.from(stderr);
  if (codePoints.length <= 4_096) return stderr;
  return `${codePoints.slice(0, 4_096).join("")}… [truncated]`;
}

function completedProcessError(result: PlannotatorRunResult): ToolErrorResult | null {
  if (result.exitCode === 0) return null;
  return toolError(
    "plannotator_failed",
    `Plannotator exited with code ${result.exitCode}: ${boundedStderr(result.stderr)}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractLatestAssistantText(history: readonly unknown[]): string | null {
  for (const message of history) {
    if (!isRecord(message) || message.message_type !== "assistant_message") continue;
    if (message.is_err === true) continue;
    if (typeof message.content === "string" && message.content.trim() !== "") return message.content;
    if (Array.isArray(message.content)) {
      const text = message.content
        .filter(
          (block): block is Record<string, unknown> =>
            isRecord(block) &&
            (block.type === undefined || block.type === "text") &&
            typeof block.text === "string",
        )
        .map((block) => block.text as string)
        .join("");
      if (text.trim() !== "") return text;
    }
  }
  return null;
}

export function createPlannotatorTools(dependencies: PlannotatorDependencies = {}): ToolDefinition[] {
  const runner = dependencies.runner ?? runPlannotator;

  return [
    {
      name: "plannotator_annotate",
      description:
        "Only when the user explicitly requests Plannotator: open a browser annotation session for a file, folder, or URL. Return exact feedback for requested changes; preserve feedback attached to approval as guidance; report dismissal without inventing feedback.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "File, folder, or HTTP(S) URL to annotate." },
          gate: { type: "boolean", description: "Show Plannotator's approval control." },
          markdown: { type: "boolean", description: "Convert HTML input to Markdown." },
          no_jina: { type: "boolean", description: "Fetch URL content without Jina Reader." },
          tailscale: {
            type: "boolean",
            description: "Publish the review session over the operator's Tailscale tailnet.",
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
      requiresApproval: true,
      parallelSafe: false,
      async run(context) {
        const target = context.args.target;
        if (typeof target !== "string" || target.trim() === "") {
          return toolError("invalid_arguments", "target must be a non-empty string");
        }
        if (target.startsWith("-")) {
          return toolError(
            "invalid_arguments",
            "target must not begin with '-' (use './' or an absolute path for such filenames)",
          );
        }
        const args = ["annotate", target];
        if (context.args.gate === true) args.push("--gate");
        if (context.args.markdown === true) args.push("--markdown");
        if (context.args.no_jina === true) args.push("--no-jina");
        if (context.args.tailscale === true) args.push("--tailscale");
        args.push("--json");
        const result = await invokeRunner(runner, {
          args,
          cwd: context.cwd,
          signal: context.signal,
        });
        if ("status" in result) return result;
        const processError = completedProcessError(result);
        if (processError) return processError;
        return parseDecision(result.stdout);
      },
    },
    {
      name: "plannotator_review",
      description:
        "Only when the user explicitly requests Plannotator: open a browser code review of active VCS changes or a supplied PR/MR URL. Tailscale mode publishes the session over the operator's tailnet.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Optional GitHub PR or GitLab MR URL." },
          force_git: { type: "boolean", description: "Force git instead of VCS auto-detection." },
          vcs: {
            type: "string",
            enum: ["auto", "git", "gitbutler"],
            description: "VCS selection. GitButler requires a compatible local 'but' executable.",
          },
          local_checkout: {
            type: "boolean",
            description: "For URL reviews, prepare a local checkout when true or use diff-only mode when false.",
          },
          tailscale: {
            type: "boolean",
            description: "Publish the review session over the operator's Tailscale tailnet.",
          },
        },
        additionalProperties: false,
      },
      requiresApproval: true,
      parallelSafe: false,
      async run(context) {
        const url = context.args.url;
        if (url !== undefined) {
          let parsedUrl: URL;
          try {
            if (typeof url !== "string" || url.trim() === "") throw new Error("invalid URL");
            parsedUrl = new URL(url);
          } catch {
            return toolError("invalid_arguments", "url must be an HTTP(S) URL");
          }
          if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
            return toolError("invalid_arguments", "url must be an HTTP(S) URL");
          }
        }
        if (context.args.local_checkout !== undefined && typeof url !== "string") {
          return toolError("invalid_arguments", "local_checkout requires a review URL");
        }
        const vcs = context.args.vcs;
        if (vcs !== undefined && vcs !== "auto" && vcs !== "git" && vcs !== "gitbutler") {
          return toolError("invalid_arguments", "vcs must be auto, git, or gitbutler");
        }
        if (context.args.force_git === true && vcs !== undefined && vcs !== "git") {
          return toolError("invalid_arguments", `force_git conflicts with vcs='${String(vcs)}'`);
        }
        const args = ["review"];
        if (context.args.force_git === true || vcs === "git") args.push("--git");
        if (vcs === "gitbutler") args.push("--gitbutler");
        if (context.args.local_checkout === true) args.push("--local");
        if (context.args.local_checkout === false) args.push("--no-local");
        if (context.args.tailscale === true) args.push("--tailscale");
        if (typeof url === "string") args.push(url);
        const result = await invokeRunner(runner, {
          args,
          cwd: context.cwd,
          signal: context.signal,
        });
        if ("status" in result) return result;
        const processError = completedProcessError(result);
        if (processError) return processError;
        return successText(result.stdout);
      },
    },
    {
      name: "plannotator_annotate_last",
      description:
        "Only when the user explicitly requests Plannotator: annotate the latest rendered Letta assistant response. Return exact requested changes, preserve approval notes as guidance, and report dismissal without inventing feedback.",
      parameters: {
        type: "object",
        properties: {
          gate: { type: "boolean", description: "Show Plannotator's approval control." },
          tailscale: {
            type: "boolean",
            description: "Publish the review session over the operator's Tailscale tailnet.",
          },
        },
        additionalProperties: false,
      },
      requiresApproval: true,
      parallelSafe: false,
      async run(context) {
        if (!context.conversation) {
          return toolError("plannotator_failed", "Letta conversation history is unavailable");
        }
        let history: unknown[];
        try {
          history = await context.conversation.getHistory({
            order: "desc",
            limit: 100,
            includeErrors: false,
          });
        } catch (error) {
          return toolError(
            "plannotator_failed",
            `Unable to read Letta conversation history: ${boundedStderr(
              error instanceof Error ? error.message : String(error),
            )}`,
          );
        }
        const text = extractLatestAssistantText(history);
        if (text === null) {
          return toolError("no_assistant_message", "No rendered assistant response is available to annotate");
        }
        if (Buffer.byteLength(text, "utf8") > 1024 * 1024) {
          return toolError("input_limit_exceeded", "Assistant response exceeds the 1 MiB stdin limit");
        }
        const args = ["annotate-last", "--stdin"];
        if (context.args.gate === true) args.push("--gate");
        if (context.args.tailscale === true) args.push("--tailscale");
        args.push("--json");
        const result = await invokeRunner(runner, {
          args,
          cwd: context.cwd,
          signal: context.signal,
          stdin: text,
        });
        if ("status" in result) return result;
        const processError = completedProcessError(result);
        if (processError) return processError;
        return parseDecision(result.stdout);
      },
    },
    {
      name: "plannotator_setup_goal",
      description:
        "Only when the user explicitly requests Plannotator goal setup: open the interview or facts browser stage for an existing JSON bundle and return its submitted JSON. Wait for the human session to finish; do not restart it merely because it is idle.",
      parameters: {
        type: "object",
        properties: {
          stage: {
            type: "string",
            enum: ["interview", "facts"],
            description: "Goal-setup browser stage to open.",
          },
          bundle_path: {
            type: "string",
            description: "Path to the interview or facts JSON bundle, relative to the active cwd or absolute.",
          },
        },
        required: ["stage", "bundle_path"],
        additionalProperties: false,
      },
      requiresApproval: true,
      parallelSafe: false,
      async run(context) {
        const stage = context.args.stage;
        if (stage !== "interview" && stage !== "facts") {
          return toolError("invalid_arguments", "stage must be interview or facts");
        }
        const bundlePath = context.args.bundle_path;
        if (typeof bundlePath !== "string" || bundlePath.trim() === "") {
          return toolError("invalid_arguments", "bundle_path must be a non-empty string");
        }
        if (bundlePath.startsWith("-")) {
          return toolError(
            "invalid_arguments",
            "bundle_path must not begin with '-' (use './' or an absolute path for such filenames)",
          );
        }
        const result = await invokeRunner(runner, {
          args: ["setup-goal", stage, bundlePath, "--json"],
          cwd: context.cwd,
          signal: context.signal,
        });
        if ("status" in result) return result;
        const processError = completedProcessError(result);
        if (processError) return processError;
        return parseGoalSetupResult(result.stdout);
      },
    },
  ];
}

export default function activate(letta: LettaHost): Disposable | undefined {
  if (!letta.capabilities?.tools) return undefined;
  const disposers: Disposable[] = [];
  try {
    for (const tool of createPlannotatorTools()) disposers.push(letta.tools.register(tool));
  } catch (error) {
    for (let index = disposers.length - 1; index >= 0; index -= 1) disposers[index]?.();
    throw error;
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (let index = disposers.length - 1; index >= 0; index -= 1) disposers[index]?.();
  };
}
