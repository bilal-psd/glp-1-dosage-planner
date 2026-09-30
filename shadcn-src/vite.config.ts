import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  // Served from GitHub Pages under /glp-1-dosage-planner/shadcn/; the maths is shared with the main page (../model.js)
  base: "./",
  // Built into ../shadcn so GitHub Pages serves it at /glp-1-dosage-planner/shadcn/
  build: { outDir: "../shadcn", emptyOutDir: true },
  server: { port: 5174, fs: { allow: [".."] } },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
