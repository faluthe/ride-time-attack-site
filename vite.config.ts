import { defineConfig } from "vite";

// Relative base, so the build works from any server path. Data is fetched over HTTP (lap traces
// load on demand), so there's no file:// support and Vite's default module build is fine.
export default defineConfig({
  base: "./",
});
