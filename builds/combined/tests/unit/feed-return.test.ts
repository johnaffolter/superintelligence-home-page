import assert from "node:assert/strict";
import { test } from "node:test";
import { safeFeedReturn } from "../../lib/feed-return.ts";

test("preserves feed filters and saved stories while rejecting external paths", () => {
  assert.equal(safeFeedReturn("/?q=alignment&sort=rigor&page=2"), "/?q=alignment&sort=rigor&page=2");
  assert.equal(safeFeedReturn("/saved"), "/saved");
  for (const value of ["//example.com", "https://example.com", "/other", "/\\example.com", "/?" + "x".repeat(2_000), null]) {
    assert.equal(safeFeedReturn(value), "/");
  }
});
