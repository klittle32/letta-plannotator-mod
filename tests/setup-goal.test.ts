import { describe, expect, test } from "bun:test";

import { createPlannotatorTools } from "../src/plannotator.js";

describe("plannotator_setup_goal", () => {
  test("opens an interview bundle and returns its JSON result", async () => {
    const requests: unknown[] = [];
    const stdout = '{"decision":"submitted","answers":[{"id":"scope","answer":"UI"}]}\n';
    const tool = createPlannotatorTools({
      runner: async (request) => {
        requests.push(request);
        return { stdout, stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_setup_goal");

    const result = await tool?.run({
      args: { stage: "interview", bundle_path: "goals/search/interview.json" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(requests).toEqual([
      {
        args: ["setup-goal", "interview", "goals/search/interview.json", "--json"],
        cwd: "/repo",
        signal: expect.any(AbortSignal),
      },
    ]);
    expect(result).toEqual({ status: "success", content: stdout });
  });

  test("supports the facts stage", async () => {
    const requests: Array<{ args: string[] }> = [];
    const tool = createPlannotatorTools({
      runner: async (request) => {
        requests.push(request);
        return { stdout: '{"decision":"submitted","facts":[]}', stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_setup_goal");

    await tool?.run({
      args: { stage: "facts", bundle_path: "goals/search/facts-review.json" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(requests[0]?.args).toEqual([
      "setup-goal",
      "facts",
      "goals/search/facts-review.json",
      "--json",
    ]);
  });

  test("rejects unsupported stages and option-like paths without launching", async () => {
    let launches = 0;
    const tool = createPlannotatorTools({
      runner: async () => {
        launches += 1;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_setup_goal");

    const invalidStage = await tool?.run({
      args: { stage: "plan", bundle_path: "bundle.json" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });
    const invalidPath = await tool?.run({
      args: { stage: "facts", bundle_path: "--help" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(launches).toBe(0);
    expect(invalidStage).toEqual({
      status: "error",
      content: '{"code":"invalid_arguments","message":"stage must be interview or facts"}',
    });
    expect(invalidPath).toEqual({
      status: "error",
      content: JSON.stringify({
        code: "invalid_arguments",
        message: "bundle_path must not begin with '-' (use './' or an absolute path for such filenames)",
      }),
    });
  });

  test("rejects malformed or non-object JSON output", async () => {
    for (const stdout of ["not json", "[]", "null"]) {
      const tool = createPlannotatorTools({
        runner: async () => ({ stdout, stderr: "", exitCode: 0 }),
      }).find(({ name }) => name === "plannotator_setup_goal");

      const result = await tool?.run({
        args: { stage: "interview", bundle_path: "bundle.json" },
        cwd: "/repo",
        signal: new AbortController().signal,
      });

      expect(result).toEqual({
        status: "error",
        content: '{"code":"invalid_json","message":"Plannotator returned invalid goal-setup JSON."}',
      });
    }
  });
});
