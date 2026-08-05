import { expect, test } from "bun:test";

import { createPlannotatorTools } from "../src/plannotator.js";

test("annotation results use Letta-native status and content fields", async () => {
  const tool = createPlannotatorTools({
    runner: async () => ({ stdout: '{"decision":"approved"}', stderr: "", exitCode: 0 }),
  }).find(({ name }) => name === "plannotator_annotate");

  const result = await tool?.run({
    args: { target: "plan.md" },
    cwd: "/repo",
    signal: new AbortController().signal,
  });

  expect(result).toEqual({
    status: "success",
    content: '{"decision":"approved"}',
  });
});
