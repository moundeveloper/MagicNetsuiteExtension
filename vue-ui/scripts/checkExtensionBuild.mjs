import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  allExtensionEntries,
  outputPathFor,
  pageEntries
} from "./extensionEntries.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");
const sourceRoot = resolve(repoRoot, "extension-src");
const outputRoot = resolve(repoRoot, "src");
const manifest = JSON.parse(
  await readFile(resolve(outputRoot, "manifest.json"), "utf8")
);

const requiredManifestScripts = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? [])
].filter(Boolean);
const webAccessibleResources = new Set(
  (manifest.web_accessible_resources ?? []).flatMap(
    (entry) => entry.resources ?? []
  )
);

const expectedOutputs = allExtensionEntries.map(outputPathFor);
const failures = [];

for (const relativePath of allExtensionEntries) {
  try {
    await stat(resolve(sourceRoot, relativePath));
  } catch {
    failures.push(`Missing TypeScript source: ${relativePath}`);
  }
}

for (const relativePath of expectedOutputs) {
  try {
    const output = await readFile(resolve(outputRoot, relativePath), "utf8");
    if (output.includes("sourceMappingURL=")) {
      failures.push(`Production source map reference found: ${relativePath}`);
    }
  } catch {
    failures.push(`Missing compiled output: ${relativePath}`);
  }
}

for (const relativePath of requiredManifestScripts) {
  if (!expectedOutputs.includes(relativePath)) {
    failures.push(`Manifest script is not built from TypeScript: ${relativePath}`);
  }
}

for (const relativePath of pageEntries.map(outputPathFor)) {
  if (!webAccessibleResources.has(relativePath)) {
    failures.push(`Page-world script is not web accessible: ${relativePath}`);
  }
}

const findTypeScript = async (directory) => {
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await findTypeScript(absolutePath)));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      matches.push(absolutePath);
    }
  }
  return matches;
};

const shippedTypeScript = await findTypeScript(outputRoot);
if (shippedTypeScript.length > 0) {
  failures.push(
    `TypeScript source found in production extension tree: ${shippedTypeScript.join(", ")}`
  );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `Validated ${expectedOutputs.length} compiled extension scripts and manifest entry points.`
);
