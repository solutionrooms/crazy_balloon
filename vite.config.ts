import { defineConfig } from "vite";

// Relative base so the build works on GitHub Pages project pages
// (https://<user>.github.io/<repo>/) without hardcoding the repo name.
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
});
