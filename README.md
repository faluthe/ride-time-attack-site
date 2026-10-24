# Ride Time Attack: site

Two pages, linked from the header (the layout carries over between them):

- **Laps** (`index.html`): a full-screen playback view of one logged lap. The racing line fills
  the screen on a top-down map (coloured by speed, throttle & brake, or g); up to three laps can
  be compared with it, their exact lines overlaid on the map (zoom in with the wheel, a pinch or
  the buttons; the road is drawn to scale) and on every chart. The toolbar picks the layout, the
  lap and the compare laps ("All laps" lists them in a table), and toggles the panels: one chart
  each for speed, lean, inputs (throttle & brake), gear, rpm, g and delta (time gained or lost
  against the compare laps), plus the readout (values under the cursor) and tiles (the lap's
  summary). Panels sit in a column beside the map (under it on narrow screens); which are on is
  remembered per browser. The names match the logger's panel toggles.
- **Records** (`records.html`): the game's own records per layout, from the saves: best laps by
  bike class from the offline leaderboards, then career results (collapsed: Time Attack comes
  first).

Scrubbing: hover or drag along any chart, click the line on the map, or drag the slider under
the map; the map markers, chart crosshairs and the readout all follow. Play runs the lap in real
time (¼× to 4×), with Follow keeping the rider centred while zoomed. Compare laps line up at the
same distance (readout shows the time gap there) or at the same lap time, like racing a ghost.
Keys: space plays and pauses, ← / → step 10 m (shift: 100 m), escape clears the cursor.

The laps page lists layouts with logged laps and opens on one of them; the records page lists
layouts with saved leaderboards or career results ("Show all tracks" lists every layout).

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

`public/data/` is generated, so it isn't committed. Each page loads `tracks.json`, the lap index
`laps.json`, `leaderboards.json` and `career.json` up front; a lap's trace
(`laps/<id>.bin.gz`, decoded by `src/lapfile.ts`; the format is "Lap files" in the logger README)
is fetched when the lap is opened or picked for compare, and kept in memory. The data is fetched,
so the site needs HTTP: opening `dist/index.html` from disk (`file://`) doesn't work.

URL options: `#kanto_c` picks a layout on either page. On the laps page,
`?lap=<id>&cmp=<id>,<id>` opens a lap and compare laps; `at=<metres>` puts the cursor there and
`zoom=<factor>` zooms the map in around it (the address bar keeps all of these up to date, so a
view can be linked). `?theme=dark|light` forces a theme.

The theme comes from `src/theme/tokens.json`. Don't edit it here: edit `../theme/tokens.json` and
run `../sync-theme.sh`, so the site and the logger stay identical. Styles and charts refer to
colours by role (`var(--throttle)`, `color("brake")`) only.
