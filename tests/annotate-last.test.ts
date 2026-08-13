import { describe, expect, test } from "bun:test";

import { createPlannotatorTools } from "../src/plannotator.js";

describe("plannotator_annotate_last", () => {
  test("sends the latest Letta assistant text through stdin", async () => {
    const historyOptions: unknown[] = [];
    const requests: unknown[] = [];
    const tool = createPlannotatorTools({
      runner: async (request) => {
        requests.push(request);
        return { stdout: '{"decision":"approved"}', stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_annotate_last");

    const result = await tool?.run({
      args: {},
      cwd: "/repo",
      signal: new AbortController().signal,
      conversation: {
        async getHistory(options) {
          historyOptions.push(options);
          return [{ message_type: "assistant_message", content: "Review this response" }];
        },
      },
    });

    expect(historyOptions).toEqual([{ order: "desc", limit: 100, includeErrors: false }]);
    expect(requests).toEqual([
      {
        args: ["annotate-last", "--stdin", "--json"],
        cwd: "/repo",
        signal: expect.any(AbortSignal),
        stdin: "Review this response",
      },
    ]);
    expect(result).toEqual({ status: "success", content: '{"decision":"approved"}' });
  });

  test("adds the approval gate and tailnet publishing when requested", async () => {
    const requests: Array<{ args: string[] }> = [];
    const tool = createPlannotatorTools({
      runner: async (request) => {
        requests.push(request);
        return { stdout: '{"decision":"approved"}', stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_annotate_last");

    await tool?.run({
      args: { gate: true, tailscale: true },
      cwd: "/repo",
      signal: new AbortController().signal,
      conversation: {
        async getHistory() {
          return [{ message_type: "assistant_message", content: "Review this" }];
        },
      },
    });

    expect(requests[0]?.args).toEqual([
      "annotate-last",
      "--stdin",
      "--gate",
      "--tailscale",
      "--json",
    ]);
  });

  test("returns no_assistant_message without launching when history has no rendered response", async () => {
    let launches = 0;
    const tool = createPlannotatorTools({
      runner: async () => {
        launches += 1;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_annotate_last");

    const result = await tool?.run({
      args: {},
      cwd: "/repo",
      signal: new AbortController().signal,
      conversation: {
        async getHistory() {
          return [{ message_type: "tool_return_message", tool_return: "hidden" }];
        },
      },
    });

    expect(launches).toBe(0);
    expect(result).toEqual({
      status: "error",
      content:
        '{"code":"no_assistant_message","message":"No rendered assistant response is available to annotate"}',
    });
  });

  test("returns a bounded error when conversation history cannot be read", async () => {
    const tool = createPlannotatorTools().find(({ name }) => name === "plannotator_annotate_last");

    const result = await tool?.run({
      args: {},
      cwd: "/repo",
      signal: new AbortController().signal,
      conversation: {
        async getHistory() {
          throw new Error("backend unavailable");
        },
      },
    });

    expect(result).toEqual({
      status: "error",
      content:
        '{"code":"plannotator_failed","message":"Unable to read Letta conversation history: backend unavailable"}',
    });
  });

  test("rejects assistant text larger than the stdin limit without launching", async () => {
    let launches = 0;
    const tool = createPlannotatorTools({
      runner: async () => {
        launches += 1;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_annotate_last");

    const result = await tool?.run({
      args: {},
      cwd: "/repo",
      signal: new AbortController().signal,
      conversation: {
        async getHistory() {
          return [{ message_type: "assistant_message", content: "x".repeat(1024 * 1024 + 1) }];
        },
      },
    });

    expect(launches).toBe(0);
    expect(result).toEqual({
      status: "error",
      content:
        '{"code":"input_limit_exceeded","message":"Assistant response exceeds the 1 MiB stdin limit"}',
    });
  });
});
