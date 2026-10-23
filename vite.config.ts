import { defineConfig, type Plugin } from "vite";

// Browsers refuse module scripts and crossorigin stylesheets from file:// URLs, so the production
// build is a single classic (IIFE) script with plain tags. The built site then opens straight from
// disk, as well as from any server or sub-path (relative base).
const classicScript = (): Plugin => ({
  name: "classic-script",
  apply: "build",
  enforce: "post",
  transformIndexHtml: (html) => html.replace(/ type="module" crossorigin/g, " defer").replace(/ crossorigin/g, ""),
});

export default defineConfig({
  base: "./",
  plugins: [classicScript()],
  build: {
    modulePreload: false,
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
  },
});
