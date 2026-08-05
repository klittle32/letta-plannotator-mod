import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPlannotator } from "../src/plannotator.js";

describe.serial("runPlannotator", () => {
  const temporaryDirectories: string[] = [];
  const originalPlannotatorBin = process.env.PLANNOTATOR_BIN;

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
    if (originalPlannotatorBin === undefined) delete process.env.PLANNOTATOR_BIN;
    else process.env.PLANNOTATOR_BIN = originalPlannotatorBin;
  });

  test("launches without a shell and captures argv, cwd, stdin, and output", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "letta-plannotator-mod-"));
    temporaryDirectories.push(cwd);
    const fixture = join(cwd, "fixture.mjs");
    await writeFile(
      fixture,
      [
        'let stdin = "";',
        'for await (const chunk of process.stdin) stdin += chunk;',
        "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), stdin }));",
      ].join("\n"),
    );

    const result = await runPlannotator(
      {
        args: ["annotate", "plan with spaces.md", "--json"],
        cwd,
        stdin: "message body",
        signal: new AbortController().signal,
      },
      { executable: process.execPath, prefixArgs: [fixture] },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      args: ["annotate", "plan with spaces.md", "--json"],
      cwd: await realpath(cwd),
      stdin: "message body",
    });
  });

  test("stops a child whose stdout exceeds the capture limit", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "letta-plannotator-mod-"));
    temporaryDirectories.push(cwd);
    const fixture = join(cwd, "overflow.mjs");
    await writeFile(fixture, 'process.stdout.write("x".repeat(1024 * 1024 + 1));\n');

    const execution = runPlannotator(
      {
        args: [],
        cwd,
        signal: new AbortController().signal,
      },
      { executable: process.execPath, prefixArgs: [fixture] },
    );

    await expect(execution).rejects.toMatchObject({ code: "OUTPUT_LIMIT_EXCEEDED" });
  });

  test("forces termination after output overflow when graceful termination is ignored", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "letta-plannotator-mod-"));
    temporaryDirectories.push(cwd);
    const fixture = join(cwd, "ignore-term.mjs");
    await writeFile(
      fixture,
      [
        'process.on("SIGTERM", () => {});',
        'process.stdout.write("x".repeat(1024 * 1024 + 1));',
        "setTimeout(() => process.exit(0), 250);",
      ].join("\n"),
    );
    const started = Date.now();

    const execution = runPlannotator(
      {
        args: [],
        cwd,
        signal: new AbortController().signal,
      },
      { executable: process.execPath, prefixArgs: [fixture], terminationGraceMs: 20 },
    );

    await expect(execution).rejects.toMatchObject({ code: "OUTPUT_LIMIT_EXCEEDED" });
    expect(Date.now() - started).toBeLessThan(180);
  });

  test("terminates a running child when the invocation is aborted", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "letta-plannotator-mod-"));
    temporaryDirectories.push(cwd);
    const fixture = join(cwd, "wait.mjs");
    await writeFile(fixture, "setTimeout(() => process.exit(0), 250);\n");
    const controller = new AbortController();

    const execution = runPlannotator(
      {
        args: [],
        cwd,
        signal: controller.signal,
      },
      { executable: process.execPath, prefixArgs: [fixture] },
    );
    setTimeout(() => controller.abort(), 20);

    await expect(execution).rejects.toMatchObject({ code: "ABORT_ERR" });
  });

  test("does not launch when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const execution = runPlannotator(
      {
        args: [],
        cwd: tmpdir(),
        signal: controller.signal,
      },
      { executable: "/definitely/not/a/real/executable" },
    );

    await expect(execution).rejects.toMatchObject({ code: "ABORT_ERR" });
  });

  test("rejects a relative PLANNOTATOR_BIN override", async () => {
    process.env.PLANNOTATOR_BIN = "relative/plannotator";

    const execution = runPlannotator({
      args: [],
      cwd: tmpdir(),
      signal: new AbortController().signal,
    });

    await expect(execution).rejects.toMatchObject({ code: "INVALID_EXECUTABLE" });
  });
});
