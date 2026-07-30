import { build } from "esbuild";
import { resolve } from "node:path";
import {
  backgroundEntry,
  contentModuleEntries,
  contentRuntimeEntries,
  pageEntries
} from "./extensionEntries.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");
const sourceRoot = resolve(repoRoot, "extension-src");
const outputRoot = resolve(repoRoot, "src");

const sharedOptions = {
  absWorkingDir: sourceRoot,
  bundle: true,
  charset: "utf8",
  legalComments: "none",
  minify: true,
  platform: "browser",
  sourcemap: false,
  target: ["chrome109"],
  treeShaking: true
};

await build({
  ...sharedOptions,
  entryPoints: [backgroundEntry],
  format: "iife",
  outfile: resolve(outputRoot, "background.js")
});

await build({
  ...sharedOptions,
  entryPoints: contentRuntimeEntries,
  entryNames: "[dir]/[name]",
  format: "iife",
  outbase: sourceRoot,
  outdir: outputRoot
});

// Keep minified ESM outputs for module-level tests and stable legacy URLs while
// the runtime content entry itself is delivered as one bundled classic script.
await build({
  ...sharedOptions,
  bundle: false,
  entryPoints: contentModuleEntries,
  entryNames: "[dir]/[name]",
  format: "esm",
  outbase: sourceRoot,
  outdir: outputRoot
});

await build({
  ...sharedOptions,
  // Page scripts intentionally reference NetSuite's AMD `require` global.
  // Bundling would reinterpret that identifier as CommonJS and break lookup.
  bundle: false,
  entryPoints: pageEntries,
  entryNames: "[dir]/[name]",
  format: "iife",
  outbase: sourceRoot,
  outdir: outputRoot
});

console.log(
  `Built ${
    1 +
    contentRuntimeEntries.length +
    contentModuleEntries.length +
    pageEntries.length
  } minified extension scripts.`
);
