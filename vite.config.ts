import { defineConfig } from "vite";

// Relative base, so the build works from any server path. Data is fetched over HTTP (lap traces
// load on demand), so there's no file:// support and Vite's default module build is fine.
// Three pages: the tracks with logged laps, the laps (playback) view and the records from the saves.
export default defineConfig({
  base: "./",
  build: {
    rolldownOptions: {
      input: { home: "index.html", laps: "laps.html", records: "records.html" },
    },
  },
});
