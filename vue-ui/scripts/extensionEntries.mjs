export const backgroundEntry = "background.ts";

export const contentRuntimeEntries = [
  "content/content.ts",
  "content/elementScreenshotPicker.ts",
  "content/elementScreenshotShortcut.ts",
  "content/quizCitationFrame.ts",
  "content/suiteletIframeBridge.ts",
  "content/suiteletIframePatch.ts"
];

export const contentModuleEntries = [
  "content/content_export.ts",
  "content/core/injection/scriptInjector.ts",
  "content/core/injection/scripts.ts",
  "content/core/interceptors/fetchInterceptor.ts",
  "content/core/interceptors/xhrInterceptor.ts",
  "content/core/messaging/constants.ts",
  "content/core/messaging/handlers.ts",
  "content/core/messaging/messageListener.ts",
  "content/core/messaging/requestManager.ts",
  "content/keyboard/shortcuts.ts",
  "content/modules/suiteScriptScraper.ts",
  "content/ui/dock/dock.ts",
  "content/ui/dock/styles.ts",
  "content/ui/frame/iframe.ts",
  "content/ui/palette/palette.ts",
  "content/ui/widgets/logo.ts",
  "content/utils/settings.ts",
  "content/utils/validators.ts"
];

export const pageEntries = [
  "globalUtils.ts",
  "netsuiteApi/advancedPdfTemplates.ts",
  "netsuiteApi/customRecords.ts",
  "netsuiteApi/exportRecord.ts",
  "netsuiteApi/lists.ts",
  "netsuiteApi/logs.ts",
  "netsuiteApi/mediaItems.ts",
  "netsuiteApi/netsuiteApi.ts",
  "netsuiteApi/sandboxCode.ts",
  "netsuiteApi/scripts.ts",
  "netsuiteApi/serverScriptManager.ts",
  "netsuiteApi/suiteQL.ts"
];

export const outputPathFor = (entry) => entry.replace(/\.ts$/, ".js");

export const allExtensionEntries = [
  backgroundEntry,
  ...contentRuntimeEntries,
  ...contentModuleEntries,
  ...pageEntries
];
