import { describe, expect, test } from "bun:test";

import activate, { createPlannotatorTools, type LettaHost } from "../src/plannotator.js";

function fakeHost(toolsAvailable: boolean) {
  const registrations: unknown[] = [];
  const host: LettaHost = {
    capabilities: { tools: toolsAvailable },
    tools: {
      register(definition) {
        registrations.push(definition);
        return () => {};
      },
    },
  };
  return { host, registrations };
}

describe("activation", () => {
  test("registers nothing when the host has no tool capability", () => {
    const { host, registrations } = fakeHost(false);

    expect(activate(host)).toBeUndefined();
    expect(registrations).toEqual([]);
  });

  test("registers exactly the three Plannotator tools", () => {
    const { host, registrations } = fakeHost(true);

    const dispose = activate(host);

    expect(registrations.map((tool) => (tool as { name: string }).name)).toEqual([
      "plannotator_annotate",
      "plannotator_review",
      "plannotator_annotate_last",
    ]);
    expect(typeof dispose).toBe("function");
  });

  test("returns an idempotent disposer for all three registrations", () => {
    const disposalCounts = [0, 0, 0];
    let registrationIndex = 0;
    const host: LettaHost = {
      capabilities: { tools: true },
      tools: {
        register() {
          const index = registrationIndex;
          registrationIndex += 1;
          return () => {
            disposalCounts[index] += 1;
          };
        },
      },
    };

    const dispose = activate(host);
    dispose?.();
    dispose?.();

    expect(disposalCounts).toEqual([1, 1, 1]);
  });

  test("publishes strict schemas and ordinary approval policy", () => {
    const tools = createPlannotatorTools();

    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.requiresApproval).toBe(true);
      expect(tool.parallelSafe).toBe(false);
      expect(tool).not.toHaveProperty("approvalPolicy");
      expect(tool.parameters).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }
    expect(tools[0]?.parameters).toMatchObject({ required: ["target"] });
  });

  test("rolls back earlier registrations when activation fails", () => {
    let registrations = 0;
    let disposals = 0;
    const host: LettaHost = {
      capabilities: { tools: true },
      tools: {
        register() {
          registrations += 1;
          if (registrations === 2) throw new Error("duplicate tool");
          return () => {
            disposals += 1;
          };
        },
      },
    };

    expect(() => activate(host)).toThrow("duplicate tool");
    expect(disposals).toBe(1);
  });
});
