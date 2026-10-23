#!/bin/sh
# Re-export the logger data and upload it to the R2 bucket the live site reads /data/* from.
# Site code deploys itself on push to main (Workers Builds); run this after a session.
set -eu

BUCKET=ride-time-attack-data
DATA=public/data
cd "$(dirname "$0")"

put() { # put <local file> <key> <content type>
  npx wrangler r2 object put "$BUCKET/$2" --file "$1" --content-type "$3" --remote
}
# lap file keys (laps/<id>.bin.gz) listed in a laps.json read from stdin
lap_files() { grep -o '"file":"laps/[^"]*"' | sed 's/^"file":"//; s/"$//' | sort -u; }

(cd ../logger && cargo run --release --bin rta-export -- --out "../site/$DATA")

# The index that's live now says which lap files the bucket has (wrangler can't list a bucket).
old=$(mktemp)
trap 'rm -f "$old"' EXIT
npx wrangler r2 object get "$BUCKET/laps.json" --pipe --remote 2>/dev/null | lap_files >"$old" || true

# Lap files first and laps.json last, so the live index never points at a missing file. The lap
# files are stored gzipped as-is (no Content-Encoding); the site gunzips them itself.
for f in "$DATA"/laps/*.bin.gz; do
  [ -e "$f" ] || continue
  put "$f" "laps/$(basename "$f")" application/octet-stream
done
for f in "$DATA"/*.json; do
  put "$f" "$(basename "$f")" application/json
done

# Remove lap files the old index had but the new one doesn't.
lap_files <"$DATA/laps.json" | comm -23 "$old" - | while read -r key; do
  npx wrangler r2 object delete "$BUCKET/$key" --remote </dev/null
done
