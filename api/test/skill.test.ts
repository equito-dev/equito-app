// The agent skill (skills/equito/SKILL.md, installed through skills.sh and Hermes) is hand-written markdown, so it can
// drift from the API. These checks keep it honest: every endpoint and MCP tool is listed, and the prices match.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATALOG } from "../src/discovery.ts";
import { FREE_CALLS_PER_DAY, callPrice } from "../src/x402.ts";

const skill = readFileSync(new URL("../../skills/equito/SKILL.md", import.meta.url), "utf8");

test("the skill has the frontmatter skills.sh and Hermes require", () => {
  const front = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(front, "frontmatter block");
  assert.match(front[1], /^name: equito$/m);
  const description = front[1].match(/^description: (.+)$/m)?.[1] ?? "";
  assert.ok(description.length > 0 && description.length <= 1024, "description present and at most 1024 characters");
});

test("the skill lists every endpoint and every MCP tool", () => {
  for (const e of CATALOG) {
    const base = e.path.split("{")[0].replace(/\/$/, "");
    assert.ok(skill.includes("/v1" + base), `path /v1${e.path} missing`);
    assert.ok(skill.includes("`" + e.tool + "`"), `tool ${e.tool} missing`);
  }
});

test("the skill quotes the live prices and free quota", () => {
  assert.ok(skill.includes(`${FREE_CALLS_PER_DAY} calls a day per IP are free`));
  assert.ok(skill.includes(`${callPrice()} per call`), `price ${callPrice()} missing`);
  assert.ok(skill.includes(`${callPrice(2)} for \`trade/build\``), `trade/build price ${callPrice(2)} missing`);
});
