# Ride Time Attack: site

Three pages, linked from the header (the layout carries over between Laps and Records):

- **Tracks** (`index.html`): the landing page. A banner with the photo of the venue ridden last
  and the totals, then a card per layout with logged laps (venue photo, the layout's outline, best
  lap, lap count), each opening the Laps page on it. Old `/#<layout>` links redirect to Laps.
- **Laps** (`laps.html`): a full-screen playback view of one logged lap. The racing line fills
  the screen on a top-down map; up to three laps can
  be compared with it, their exact lines overlaid on the map (zoom in with the wheel, a pinch or
  the buttons; the road is drawn to scale) and on every chart. The toolbar picks the layout, the
  lap and the compare laps ("All laps" lists them in a table), and toggles the panels. Graphs
  (speed, lean, inputs, gear, rpm, g, delta) sit in a column beside the map; drag its edge to
  resize it. Widgets float over the map and are dragged by their title bar: readout (values under
  the cursor), timer (lap clock and the gap to each compare lap), tach (engine speed, gear, speed,
  throttle and brake), rider (lean, with compare laps as needles) and tiles (the lap's summary).
  On narrow screens both stack under the map. Which panels are on, where the widgets sit and the
  column's width are remembered per browser. The names match the logger's panel toggles.
- **Records** (`records.html`): the game's own records per layout, from the saves: best laps by
  bike class from the offline leaderboards, then career results (collapsed: Time Attack comes
  first).

Scrubbing: hover or drag along any chart, click the line on the map, or drag the slider under
the map; the map markers, chart crosshairs and the widgets all follow. Play runs the lap in real
time (¼× to 4×) and loops, with Follow keeping the rider centred while zoomed. Compare laps line up
at the same lap time, like racing a ghost (the default), or at the same distance (readout shows the
time gap there). Each lap's line and marker keep the lap's own colour, shaded by inputs (its own
colour on the throttle, blending towards the brake colour the harder it brakes, a little greyer
while coasting) or by speed (vivid where fast). When comparing, the lines are plain lap colours and
each lap's braking points (red dots) and throttle pickups (green dots) are marked, ringed in the
lap's colour (brake taps under 0.4 s or 30% don't count); the markers still shade with their
rider's inputs. The inputs graph also adds one throttle & brake strip per lap. Width draws the
track 1× to 5× wider than life on the map (each point's offset from the centreline is scaled), so
close lines separate; 2× by default, remembered per browser.
Keys: space plays and pauses, ← / → step 10 m (shift: 100 m), escape clears the cursor.

Venue photos are static files in `public/tracks/` (`<venue>.jpg`, 1920x1080, and `<venue>-card.jpg`,
640 wide), dumped once from the game by the logger's `rta-photos`; they're part of the build, not the
data, so `rta-export` and `deploy-data.sh` never touch them.

The laps page lists layouts with logged laps and opens on one of them; the records page lists
layouts with saved leaderboards or career results ("Show all tracks" lists every layout).

```sh
# in ../logger: write the data into public/data/
cargo run --release --bin rta-export -- --out ../site/public/data
cargo run --release --bin rta-photos -- --out ../site/public/tracks   # venue photos (once)

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
