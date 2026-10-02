import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  // The main page. `npm run build` (run by whoever changes app/) writes index.html and assets/ into the repo root,
  // which GitHub Pages serves at /glp-1-dosage-planner/. Relative base so it works under that sub-path.
  base: "./",
  // Never empty the output dir: it is the repo root. The build script deletes the old ../assets first instead.
  build: { outDir: "..", emptyOutDir: false },
  server: { port: 5174, fs: { allow: [".."] } },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
