import { expect, test } from "bun:test";

import activate from "../src/plannotator.js";

test("the mod entry point is importable", () => {
  expect(typeof activate).toBe("function");
});
