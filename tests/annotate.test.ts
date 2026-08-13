import { describe, expect, test } from "bun:test";

import { createPlannotatorTools } from "../src/plannotator.js";

describe("plannotator_annotate", () => {
  test("opens a target in the active cwd and returns an approved decision", async () => {
    const requests: unknown[] = [];
    const runner = async (request: unknown) => {
      requests.push(request);
      return {
        stdout: '{"decision":"approved"}\n',
        stderr: "",
        exitCode: 0,
      };
    };
    const tools = (createPlannotatorTools as unknown as (dependencies: unknown) => ReturnType<typeof createPlannotatorTools>)(
      { runner },
    );
    const tool = tools.find(({ name }) => name === "plannotator_annotate");

    const result = await tool?.run({
      args: { target: "plan.md" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(requests).toEqual([
      {
        args: ["annotate", "plan.md", "--json"],
        cwd: "/repo",
        signal: expect.any(AbortSignal),
      },
    ]);
    expect(result).toEqual({ status: "success", content: '{"decision":"approved"}' });
  });

  test("adds the approval gate when requested", async () => {
    const requests: Array<{ args: string[] }> = [];
    const tools = createPlannotatorTools({
      runner: async (request) => {
        requests.push(request);
        return { stdout: '{"decision":"approved"}', stderr: "", exitCode: 0 };
      },
    });
    const tool = tools.find(({ name }) => name === "plannotator_annotate");

    await tool?.run({
      args: { target: "plan.md", gate: true },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(requests[0]?.args).toEqual(["annotate", "plan.md", "--gate", "--json"]);
  });

  test("maps all optional flags in deterministic order", async () => {
    const requests: Array<{ args: string[] }> = [];
    const tool = createPlannotatorTools({
      runner: async (request) => {
        requests.push(request);
        return { stdout: '{"decision":"approved"}', stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_annotate");

    await tool?.run({
      args: { target: "report.html", gate: true, markdown: true, no_jina: true, tailscale: true },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(requests[0]?.args).toEqual([
      "annotate",
      "report.html",
      "--gate",
      "--markdown",
      "--no-jina",
      "--tailscale",
      "--json",
    ]);
  });

  test("rejects an empty target without launching Plannotator", async () => {
    let launches = 0;
    const tool = createPlannotatorTools({
      runner: async () => {
        launches += 1;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_annotate");

    const result = await tool?.run({
      args: { target: "   " },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(launches).toBe(0);
    expect(result).toEqual({
      status: "error",
      content: '{"code":"invalid_arguments","message":"target must be a non-empty string"}',
    });
  });

  test("rejects targets that could be interpreted as CLI options", async () => {
    let launches = 0;
    const tool = createPlannotatorTools({
      runner: async () => {
        launches += 1;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_annotate");

    const result = await tool?.run({
      args: { target: "--help" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(launches).toBe(0);
    expect(result).toEqual({
      status: "error",
      content: JSON.stringify({
        code: "invalid_arguments",
        message: "target must not begin with '-' (use './' or an absolute path for such filenames)",
      }),
    });
  });

  test("preserves annotation feedback exactly", async () => {
    const tool = createPlannotatorTools({
      runner: async () => ({
        stdout: '{"decision":"annotated","feedback":"Change line 2.\\nKeep this exact."}',
        stderr: "",
        exitCode: 0,
      }),
    }).find(({ name }) => name === "plannotator_annotate");

    const result = await tool?.run({
      args: { target: "plan.md" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "success",
      content: JSON.stringify({
        decision: "annotated",
        feedback: "Change line 2.\nKeep this exact.",
      }),
    });
  });

  test("returns a dismissed decision without inventing feedback", async () => {
    const tool = createPlannotatorTools({
      runner: async () => ({
        stdout: '{"decision":"dismissed"}',
        stderr: "",
        exitCode: 0,
      }),
    }).find(({ name }) => name === "plannotator_annotate");

    const result = await tool?.run({
      args: { target: "plan.md" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ status: "success", content: '{"decision":"dismissed"}' });
  });

  test("returns invalid_json for malformed stdout", async () => {
    const tool = createPlannotatorTools({
      runner: async () => ({ stdout: "not json", stderr: "", exitCode: 0 }),
    }).find(({ name }) => name === "plannotator_annotate");

    const result = await tool?.run({
      args: { target: "plan.md" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "error",
      content: '{"code":"invalid_json","message":"Plannotator returned an invalid decision."}',
    });
  });

  test("returns plannotator_failed for a nonzero exit", async () => {
    const tool = createPlannotatorTools({
      runner: async () => ({ stdout: "", stderr: "Unable to open browser\n", exitCode: 1 }),
    }).find(({ name }) => name === "plannotator_annotate");

    const result = await tool?.run({
      args: { target: "plan.md" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "error",
      content: JSON.stringify({
        code: "plannotator_failed",
        message: "Plannotator exited with code 1: Unable to open browser\n",
      }),
    });
  });

  test("returns plannotator_not_found when the executable is missing", async () => {
    const tool = createPlannotatorTools({
      runner: async () => {
        throw Object.assign(new Error("spawn plannotator ENOENT"), { code: "ENOENT" });
      },
    }).find(({ name }) => name === "plannotator_annotate");

    const result = await tool?.run({
      args: { target: "plan.md" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "error",
      content: '{"code":"plannotator_not_found","message":"plannotator was not found on PATH"}',
    });
  });

  test("bounds stderr included in failure messages", async () => {
    const stderr = "x".repeat(5_000);
    const tool = createPlannotatorTools({
      runner: async () => ({ stdout: "", stderr, exitCode: 2 }),
    }).find(({ name }) => name === "plannotator_annotate");

    const result = await tool?.run({
      args: { target: "plan.md" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "error",
      content: JSON.stringify({
        code: "plannotator_failed",
        message: `Plannotator exited with code 2: ${"x".repeat(4_096)}… [truncated]`,
      }),
    });
  });

  test("maps process output overflow to output_limit_exceeded", async () => {
    const tool = createPlannotatorTools({
      runner: async () => {
        throw Object.assign(new Error("output overflow"), { code: "OUTPUT_LIMIT_EXCEEDED" });
      },
    }).find(({ name }) => name === "plannotator_annotate");

    const result = await tool?.run({
      args: { target: "plan.md" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "error",
      content:
        '{"code":"output_limit_exceeded","message":"Plannotator output exceeded the 1 MiB capture limit"}',
    });
  });

  test("maps process cancellation to aborted", async () => {
    const tool = createPlannotatorTools({
      runner: async () => {
        throw Object.assign(new Error("cancelled"), { code: "ABORT_ERR" });
      },
    }).find(({ name }) => name === "plannotator_annotate");

    const result = await tool?.run({
      args: { target: "plan.md" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "error",
      content: '{"code":"aborted","message":"Plannotator invocation was aborted"}',
    });
  });

  test("rejects every unsupported decision record shape", async () => {
    const invalidRecords = [
      "[]",
      "null",
      "{}",
      '{"decision":"unknown"}',
      '{"decision":"annotated"}',
      '{"decision":"approved","feedback":123}',
      '{"decision":"dismissed","feedback":false}',
      '{"decision":"approved"}{"decision":"dismissed"}',
    ];

    for (const stdout of invalidRecords) {
      const tool = createPlannotatorTools({
        runner: async () => ({ stdout, stderr: "", exitCode: 0 }),
      }).find(({ name }) => name === "plannotator_annotate");
      const result = await tool?.run({
        args: { target: "plan.md" },
        cwd: "/repo",
        signal: new AbortController().signal,
      });

      expect(result).toEqual({
        status: "error",
        content: '{"code":"invalid_json","message":"Plannotator returned an invalid decision."}',
      });
    }
  });

  test("preserves an explicitly empty annotation feedback string", async () => {
    const tool = createPlannotatorTools({
      runner: async () => ({
        stdout: '{"decision":"annotated","feedback":""}',
        stderr: "",
        exitCode: 0,
      }),
    }).find(({ name }) => name === "plannotator_annotate");

    const result = await tool?.run({
      args: { target: "plan.md" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "success",
      content: '{"decision":"annotated","feedback":""}',
    });
  });
});
