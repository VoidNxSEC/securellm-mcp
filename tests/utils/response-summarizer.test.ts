import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { ResponseSummarizer } from "../../src/utils/response-summarizer.js";

describe("ResponseSummarizer compaction", () => {
  it("should leave short text unchanged", () => {
    const text = "short response";
    const compacted = ResponseSummarizer.compactText(text, {
      maxChars: 100,
      headChars: 20,
      tailChars: 10,
    });

    assert.equal(compacted, text);
  });

  it("should compact large text while preserving head and tail", () => {
    const text = `HEAD-${"a".repeat(200)}-MIDDLE-${"b".repeat(200)}-TAIL`;
    const compacted = ResponseSummarizer.compactText(text, {
      maxChars: 120,
      headChars: 40,
      tailChars: 30,
    });

    assert.ok(compacted.startsWith(text.slice(0, 40)));
    assert.ok(compacted.endsWith(text.slice(-30)));
    assert.match(compacted, /\[response compacted:/);
  });

  it("should compact text content inside tool-like results", () => {
    const result = {
      content: [
        {
          type: "text",
          text: JSON.stringify(
                    {
              items: Array.from({ length: 800 }, (_, i) => ({
                id: i,
                value: `entry-${i}-${"x".repeat(80)}`,
              })),
            },
            null,
            2
          ),
        },
      ],
    };

    const compacted = ResponseSummarizer.compactToolResult(result);
    const text = compacted.content?.[0]?.text;

    assert.equal(typeof text, "string");
    assert.match(text || "", /JSON object with/);
    assert.match(text || "", /\[response compacted:/);
  });
});
