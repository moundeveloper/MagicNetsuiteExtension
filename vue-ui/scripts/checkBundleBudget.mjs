import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const assetsDirectory = resolve("../src/dist/vue-ui/assets");
const files = await readdir(assetsDirectory);
const mainBundles = files.filter((file) => /^main-[^.]+\.js$/.test(file));

if (mainBundles.length !== 1) {
  throw new Error(
    `Expected one startup JavaScript bundle, found ${mainBundles.length}. Run the production build first.`
  );
}

const bundle = await readFile(resolve(assetsDirectory, mainBundles[0]));
const gzipSize = gzipSync(bundle).byteLength;
const rawBudget = 400 * 1024;
const gzipBudget = 100 * 1024;

console.log(
  `Startup bundle: ${(bundle.byteLength / 1024).toFixed(1)} KiB raw, ${(gzipSize / 1024).toFixed(1)} KiB gzip`
);

if (bundle.byteLength > rawBudget || gzipSize > gzipBudget) {
  throw new Error(
    `Startup bundle exceeds the ${rawBudget / 1024} KiB raw / ${gzipBudget / 1024} KiB gzip budget.`
  );
}
