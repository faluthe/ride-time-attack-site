#!/bin/sh
# What Workers Builds runs before deploying, locally: the build, the wrangler config (Previews
# included) and a dry-run bundle of the worker. Run by the pre-push hook (.githooks/pre-push).
set -eu
cd "$(dirname "$0")"

npm run --silent build
node scripts/check-wrangler.ts wrangler.jsonc
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
npx wrangler deploy --dry-run --outdir "$out" >"$out/log" 2>&1 || { cat "$out/log"; exit 1; }
echo "wrangler dry run ok"
