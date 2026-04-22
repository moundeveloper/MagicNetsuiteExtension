import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";
import { visualizer } from "rollup-plugin-visualizer";
import { resolve } from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), UnoCSS(), visualizer({ open: false })],
  optimizeDeps: {
    include: ["monaco-editor"]
  },
  base: "./",
  build: {
    outDir: "../src/dist/vue-ui",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        palette: resolve(__dirname, "palette.html")
      }
    }
  },
  assetsInclude: ["**/*.ftl"]
});
