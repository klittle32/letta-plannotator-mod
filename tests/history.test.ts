import { describe, expect, test } from "bun:test";

import { extractLatestAssistantText } from "../src/plannotator.js";

describe("extractLatestAssistantText", () => {
  test("selects the newest assistant string from descending history", () => {
    const result = extractLatestAssistantText([
      { message_type: "assistant_message", content: "Newest rendered response" },
      { message_type: "assistant_message", content: "Older response" },
    ]);

    expect(result).toBe("Newest rendered response");
  });

  test("joins structured assistant text without injecting whitespace", () => {
    const result = extractLatestAssistantText([
      {
        message_type: "assistant_message",
        content: [
          { type: "text", text: "First" },
          { text: " second" },
        ],
      },
    ]);

    expect(result).toBe("First second");
  });

  test("skips errors, private blocks, tools, and empty assistant messages", () => {
    const result = extractLatestAssistantText([
      { message_type: "reasoning_message", reasoning: "private" },
      { message_type: "assistant_message", content: "Errored body", is_err: true },
      { message_type: "assistant_message", content: [{ type: "text", text: "   " }] },
      {
        message_type: "assistant_message",
        content: [
          { type: "reasoning", reasoning: "private" },
          { type: "tool_call", name: "search", input: {} },
          { type: "text", text: "Visible" },
          { type: "tool_return", content: "hidden" },
        ],
      },
    ]);

    expect(result).toBe("Visible");
  });

  test("preserves whitespace-only rendered text blocks between visible blocks", () => {
    const result = extractLatestAssistantText([
      {
        message_type: "assistant_message",
        content: [
          { type: "text", text: "First" },
          { type: "text", text: " " },
          { type: "text", text: "second" },
        ],
      },
    ]);

    expect(result).toBe("First second");
  });
});
