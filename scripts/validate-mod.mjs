import assert from "node:assert/strict";

const mod = await import(new URL("../dist/plannotator.mjs", import.meta.url).href);
assert.equal(typeof mod.default, "function", "default activation export is required");

const registered = [];
let disposals = 0;
const dispose = mod.default({
  capabilities: { tools: true },
  tools: {
    register(tool) {
      registered.push(tool.name);
      return () => {
        disposals += 1;
      };
    },
  },
});

assert.deepEqual(registered, [
  "plannotator_annotate",
  "plannotator_review",
  "plannotator_annotate_last",
]);
dispose();
assert.equal(disposals, 3, "all tool registrations must be disposed");

console.log("Validated built mod under Node-compatible ESM.");
