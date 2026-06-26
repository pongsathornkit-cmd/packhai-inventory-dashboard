const test = require("node:test");
const assert = require("node:assert/strict");

const { runRuleAssistant } = require("../scripts/assistant-core.cjs");

test("handles AI sidebar menu removal command without falling back", () => {
  const command =
    "\u0e15\u0e23\u0e07\u0e41\u0e16\u0e1a\u0e40\u0e21\u0e19\u0e39\u0e14\u0e49\u0e32\u0e19\u0e0b\u0e49\u0e32\u0e22 \u0e15\u0e31\u0e14\u0e40\u0e21\u0e19\u0e39 AI Command \u0e2d\u0e2d\u0e01";
  const result = runRuleAssistant(command, {});

  assert.equal(result.source, "rule");
  assert.match(result.reply, /AI Command/);
  assert.match(result.reply, /\u0e15\u0e31\u0e14\u0e40\u0e21\u0e19\u0e39/);
  assert.deepEqual(result.actions, []);
});
