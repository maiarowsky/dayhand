// dayhand.dev: a static Astro site built into dist/. What each choice is for: STYLE.md.
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://dayhand.dev",
  output: "static",
  trailingSlash: "always",
  // Whitespace is removed only where it does not change what the page shows.
  compressHTML: true,
  build: {
    format: "directory",
    // Styles and scripts are files of their own, never <style> or <script> in the HTML.
    inlineStylesheets: "never",
  },
  vite: { build: { assetsInlineLimit: 0 } },
  image: {
    service: { entrypoint: "astro/assets/services/sharp", config: { webp: { effort: 6 } } },
  },
  devToolbar: { enabled: false },
});
