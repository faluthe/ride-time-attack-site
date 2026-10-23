#!/bin/sh
# Re-export the logger data, build the site and upload it to Cloudflare (see wrangler.jsonc).
# Needs Node 20+ and a `npx wrangler login`.
set -eu

cd "$(dirname "$0")"

(cd ../logger && cargo run --release --bin rta-export -- --out ../site/public/data)
npm run build
npx wrangler deploy
