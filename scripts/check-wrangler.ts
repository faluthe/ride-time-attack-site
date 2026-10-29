// Checks wrangler.jsonc for what Workers Builds needs but `wrangler deploy --dry-run` doesn't check:
// branch Previews (`wrangler preview`) fail unless the `previews` block repeats every binding.
// Run by ./check-deploy.sh.

import { readFileSync } from "node:fs";

/** JSON with `//` and block comments (as wrangler reads it), comments outside strings dropped. */
function parseJsonc(text: string): Record<string, unknown> {
  let out = "", i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (text.startsWith("//", i)) {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  // trailing commas are allowed too
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** Binding names by kind: every top-level array of objects with a `binding` (r2_buckets, kv_namespaces…). */
function bindings(cfg: Record<string, unknown>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [kind, v] of Object.entries(cfg)) {
    if (!Array.isArray(v)) continue;
    const names = v.flatMap((b) => (b && typeof b === "object" && typeof b.binding === "string" ? [b.binding as string] : []));
    if (names.length) out.set(kind, names.sort());
  }
  return out;
}

const file = process.argv[2] ?? "wrangler.jsonc";
const cfg = parseJsonc(readFileSync(file, "utf8"));
const previews = (cfg.previews ?? {}) as Record<string, unknown>;
const want = bindings(cfg), have = bindings(previews);
const problems: string[] = [];
for (const [kind, names] of want) {
  const missing = names.filter((n) => !(have.get(kind) ?? []).includes(n));
  if (missing.length) problems.push(`previews.${kind} is missing ${missing.map((n) => `"${n}"`).join(", ")}`);
}
if (problems.length) {
  console.error(`${file}: branch Previews will fail on Workers Builds:\n  ${problems.join("\n  ")}`);
  console.error(`Repeat each binding under "previews", pointed at something a Preview may use.`);
  process.exit(1);
}
console.log(`${file}: previews cover every binding`);
