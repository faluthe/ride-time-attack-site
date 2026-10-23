# Ride Time Attack: site

Shows laps recorded by the logger: the racing line on a top-down map (coloured by speed,
throttle & brake, or g), plus speed, lean, throttle & brake, gear, engine-speed, g and time-delta
charts against lap distance, with lap compare.

```sh
# in ../logger: write the data into public/data/
cargo run --release --bin rta-export -- --out ../site/public/data

npm install
npm run dev        # http://localhost:5173
npm run build      # dist/: open dist/index.html straight from disk, or host it anywhere
./deploy-data.sh   # export + upload the data to R2 (run after a session)
```

Live at https://ride-time-attack.faluninja.workers.dev, a Cloudflare Worker (`wrangler.jsonc`,
`worker/`). Cloudflare Workers Builds deploys the code on every push to `main`; `/data/*` is served
from the `ride-time-attack-data` R2 bucket, so code deploys never touch the laps.

`public/data/` is generated, so it isn't committed. The production build is a classic script
(not an ES module) and loads `data/data.js`, so it works from `file://` too.

URL options: `#kanto_c` picks a layout; `?lap=<id>&cmp=<id>` opens a lap and a compare lap;
`?theme=dark|light` forces a theme.

The theme comes from `src/theme/tokens.json`. Don't edit it here: edit `../theme/tokens.json` and
run `../sync-theme.sh`, so the site and the logger stay identical. Styles and charts refer to
colours by role (`var(--throttle)`, `color("brake")`) only.
