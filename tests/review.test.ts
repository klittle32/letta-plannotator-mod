import { describe, expect, test } from "bun:test";

import { createPlannotatorTools } from "../src/plannotator.js";

describe("plannotator_review", () => {
  test("reviews local changes in the active cwd", async () => {
    const requests: unknown[] = [];
    const tool = createPlannotatorTools({
      runner: async (request) => {
        requests.push(request);
        return { stdout: "Approved.\n", stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_review");

    const result = await tool?.run({
      args: {},
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(requests).toEqual([
      {
        args: ["review"],
        cwd: "/repo",
        signal: expect.any(AbortSignal),
      },
    ]);
    expect(result).toEqual({ status: "success", content: "Approved.\n" });
  });

  test("maps remote review options in deterministic order", async () => {
    const requests: Array<{ args: string[] }> = [];
    const tool = createPlannotatorTools({
      runner: async (request) => {
        requests.push(request);
        return { stdout: "Review feedback", stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_review");

    await tool?.run({
      args: {
        url: "https://github.com/example/repo/pull/42",
        force_git: true,
        local_checkout: false,
        tailscale: true,
      },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(requests[0]?.args).toEqual([
      "review",
      "--git",
      "--no-local",
      "--tailscale",
      "https://github.com/example/repo/pull/42",
    ]);
  });

  test("supports GitButler as an explicit VCS", async () => {
    const requests: Array<{ args: string[] }> = [];
    const tool = createPlannotatorTools({
      runner: async (request) => {
        requests.push(request);
        return { stdout: "Approved", stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_review");

    await tool?.run({
      args: { vcs: "gitbutler" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(requests[0]?.args).toEqual(["review", "--gitbutler"]);
  });

  test("rejects conflicting legacy and explicit VCS options", async () => {
    let launches = 0;
    const tool = createPlannotatorTools({
      runner: async () => {
        launches += 1;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_review");

    const result = await tool?.run({
      args: { force_git: true, vcs: "gitbutler" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(launches).toBe(0);
    expect(result).toEqual({
      status: "error",
      content:
        '{"code":"invalid_arguments","message":"force_git conflicts with vcs=' +
        "'gitbutler'" +
        '"}',
    });
  });

  test("rejects local_checkout without a URL", async () => {
    let launches = 0;
    const tool = createPlannotatorTools({
      runner: async () => {
        launches += 1;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_review");

    const result = await tool?.run({
      args: { local_checkout: true },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(launches).toBe(0);
    expect(result).toEqual({
      status: "error",
      content: '{"code":"invalid_arguments","message":"local_checkout requires a review URL"}',
    });
  });

  test("rejects a non-HTTP review URL", async () => {
    let launches = 0;
    const tool = createPlannotatorTools({
      runner: async () => {
        launches += 1;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    }).find(({ name }) => name === "plannotator_review");

    const result = await tool?.run({
      args: { url: "file:///tmp/review" },
      cwd: "/repo",
      signal: new AbortController().signal,
    });

    expect(launches).toBe(0);
    expect(result).toEqual({
      status: "error",
      content: '{"code":"invalid_arguments","message":"url must be an HTTP(S) URL"}',
    });
  });
});
