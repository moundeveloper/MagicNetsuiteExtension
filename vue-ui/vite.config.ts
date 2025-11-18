import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), UnoCSS()],
  optimizeDeps: {
    include: ["monaco-editor"],
  },
  base: "./",
  build: {
    outDir: "../src/dist/vue-ui",
    emptyOutDir: true,
  },
});
