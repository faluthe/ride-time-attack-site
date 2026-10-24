# Ride Time Attack: site

Shows laps recorded by the logger: the racing line on a top-down map (coloured by speed,
throttle & brake, or g), plus speed, lean, throttle & brake, gear, engine-speed, g and time-delta
charts against lap distance. Up to three laps can be compared with the one being studied: their
exact lines overlay on the map (zoom in with the wheel, a pinch or the buttons; the road is drawn
to scale) and on every chart.

Scrubbing: hover or drag along any chart, click the line on the map, or drag the slider under
the map; the map markers, chart crosshairs and the readout under the lap picker all follow. Play
runs the lap in real time (¼× to 4×), with Follow keeping the rider centred while zoomed. Compare
laps line up at the same distance (readout shows the time gap there) or at the same lap time,
like racing a ghost. Keys: space plays and pauses, ← / → step 10 m (shift: 100 m), escape clears
the cursor.

The site is built around Time Attack. Layouts with logged laps lead the track list (with a lap
count) and the page opens on one of them. The Time Attack leaderboards from your saves are shown
too. Career results don't count as data for a layout; when a layout has any, they sit in a
collapsed "Career events here" section at the bottom of its page.

```sh
# in ../logger: write the data into public/data/
cargo run --release --bin rta-export -- --out ../site/public/data

npm install        # Node 22 (.node-version); Vite 8 needs 20.19+ or 22.12+
npm run dev        # http://localhost:5173
npm run build      # dist/: static, host it on any HTTP server (npm run preview)
./deploy-data.sh   # export + upload the data and lap files to R2 (run after a session)
```

Live at https://ride-time-attack.faluninja.workers.dev, a Cloudflare Worker (`wrangler.jsonc`,
`worker/`). Cloudflare Workers Builds deploys the code on every push to `main`; `/data/*` is served
from the `ride-time-attack-data` R2 bucket, so code deploys never touch the laps. `deploy-data.sh`
uploads the lap files before `laps.json`, then deletes lap files the previous `laps.json` listed
but the new one doesn't (wrangler can't list a bucket, so the old index is the record).

`public/data/` is generated, so it isn't committed. The page loads `tracks.json`, the lap index
`laps.json`, `leaderboards.json` and `career.json` up front; a lap's trace
(`laps/<id>.bin.gz`, decoded by `src/lapfile.ts`; the format is "Lap files" in the logger README)
is fetched when the lap is opened or picked for compare, and kept in memory. The data is fetched,
so the site needs HTTP: opening `dist/index.html` from disk (`file://`) doesn't work.

URL options: `#kanto_c` picks a layout; `?lap=<id>&cmp=<id>,<id>` opens a lap and compare laps;
`at=<metres>` puts the cursor there and `zoom=<factor>` zooms the map in around it (the address
bar keeps all of these up to date, so a view can be linked); `?theme=dark|light` forces a theme.|light` forces a theme.

The theme comes from `src/theme/tokens.json`. Don't edit it here: edit `../theme/tokens.json` and
run `../sync-theme.sh`, so the site and the logger stay identical. Styles and charts refer to
colours by role (`var(--throttle)`, `color("brake")`) only.
