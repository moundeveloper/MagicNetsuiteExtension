// ============================================================================
// Main Content Script Entry Point
// ============================================================================

import { initExtension } from "./content_export.js";

(async () => {
  try {
    await initExtension();
  } catch (error) {
    console.error("[Magic Netsuite] Failed to load content module:", error);
  }
})();
