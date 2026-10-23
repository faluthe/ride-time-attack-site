#!/bin/sh
# Re-export the logger data and upload it to the R2 bucket the live site reads /data/* from.
# Site code deploys itself on push to main (Workers Builds); run this after a session.
set -eu

BUCKET=ride-time-attack-data
cd "$(dirname "$0")"

(cd ../logger && cargo run --release --bin rta-export -- --out ../site/public/data)
for f in public/data/*.js public/data/*.json; do
  case $f in
    *.js) type=text/javascript ;;
    *) type=application/json ;;
  esac
  npx wrangler r2 object put "$BUCKET/$(basename "$f")" --file "$f" --content-type "$type" --remote
done
