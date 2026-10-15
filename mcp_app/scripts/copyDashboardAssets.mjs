import { copyFile, mkdir } from "node:fs/promises";

const canonical = new URL("../../mcp_server/", import.meta.url);
const destination = new URL("../dist/dashboard-resources/", import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(new URL("dashboardTools.json", canonical), new URL("dashboardTools.json", destination));
// The host is ESM. Preserve the shared native companion helper's CommonJS format.
await copyFile(new URL("dashboardFiles.js", canonical), new URL("dashboardFiles.cjs", destination));
console.log("Copied dashboard schemas and file adapter into the standalone MCP app.");
