/** Navigation metadata shared by Vue and the NetSuite shortcut controller. */
export enum RouteStatus {
  development = "development",
  fix = "fix",
  draft = "draft",
  release = "release",
  deprecated = "deprecated",
}

export type NavigationView = {
  route: string;
  name: string;
  icon: string;
  status: RouteStatus;
  adminOnly?: boolean;
  internalOnly?: boolean;
};
export const navigationViews = {
  "/dashboards": {
    route: "/dashboards",
    name: "Dashboards",
    icon: "pi pi-th-large",
    status: RouteStatus.release,
  },
  "/": {
    route: "/",
    name: "Features",
    icon: "pi pi-home",
    status: RouteStatus.release,
  },
  "/settings": {
    route: "/settings",
    name: "Settings",
    icon: "pi pi-cog",
    status: RouteStatus.release,
  },
  "/logs": {
    route: "/logs",
    name: "Logs",
    icon: "pi pi-file",
    status: RouteStatus.release,
  },
  "/flight-recorder": {
    route: "/flight-recorder",
    name: "Flight Recorder",
    icon: "pi pi-wave-pulse",
    status: RouteStatus.release,
    adminOnly: true,
  },
  "/watchtower": {
    route: "/watchtower",
    name: "Record History",
    icon: "pi pi-history",
    status: RouteStatus.release,
  },
  "/architecture-workbench": {
    route: "/architecture-workbench",
    name: "Architecture Workbench",
    icon: "pi pi-sitemap",
    status: RouteStatus.release,
  },
  "/dependency-explorer": {
    route: "/dependency-explorer",
    name: "Dependency Explorer",
    icon: "pi pi-share-alt",
    status: RouteStatus.release,
  },
  "/download-analyzer": {
    route: "/download-analyzer",
    name: "Download Analyzer",
    icon: "pi pi-download",
    status: RouteStatus.release,
  },
  "/bundles": {
    route: "/bundles",
    name: "Bundles",
    icon: "pi pi-box",
    status: RouteStatus.release,
  },
  "/better-filecabinet": {
    route: "/better-filecabinet",
    name: "Better File Cabinet",
    icon: "pi pi-folder",
    status: RouteStatus.release,
  },
  "/custom-records": {
    route: "/custom-records",
    name: "Custom Records",
    icon: "pi pi-table",
    status: RouteStatus.release,
  },
  "/records": {
    route: "/records",
    name: "Records",
    icon: "pi pi-database",
    status: RouteStatus.release,
  },
  "/scripts": {
    route: "/scripts",
    name: "Scripts",
    icon: "pi pi-code",
    status: RouteStatus.release,
  },
  "/playground": {
    route: "/playground",
    name: "Playground",
    icon: "pi-directions-alt",
    status: RouteStatus.development,
  },
  "/run-quick-script": {
    route: "/run-quick-script",
    name: "Run Quick Script",
    icon: "pi pi-file-export",
    status: RouteStatus.release,
  },
  "/scripts-deployed": {
    route: "/scripts-deployed",
    name: "Scripts Deployed",
    icon: "pi pi-list",
    status: RouteStatus.release,
  },
  "/templates": {
    route: "/templates",
    name: "Templates",
    icon: "pi pi-file-pdf",
    status: RouteStatus.release,
  },
  "/freemarker-renderer": {
    route: "/freemarker-renderer",
    name: "FreeMarker Renderer",
    icon: "pi pi-eye",
    status: RouteStatus.release,
  },
  "/template-studio": {
    route: "/template-studio",
    name: "Template Studio",
    icon: "pi pi-sparkles",
    status: RouteStatus.release,
  },
  "/processing": {
    route: "/processing",
    name: "Execution Monitor",
    icon: "pi pi-bolt",
    status: RouteStatus.release,
    internalOnly: true,
  },
  "/jobs": {
    route: "/jobs",
    name: "Jobs Center",
    icon: "pi pi-list-check",
    status: RouteStatus.release,
  },
  "/quiz": {
    route: "/quiz",
    name: "NetSuite Quiz",
    icon: "pi pi-question-circle",
    status: RouteStatus.release,
  },
  "/suitescript-modules": {
    route: "/suitescript-modules",
    name: "SuiteScript Modules",
    icon: "pi pi-database",
    status: RouteStatus.release,
  },
  "/suiteql": {
    route: "/suiteql",
    name: "SuiteQL Editor",
    icon: "pi pi-server",
    status: RouteStatus.release,
  },
  "/mcp-server": {
    route: "/mcp-server",
    name: "MCP Server",
    icon: "pi pi-link",
    status: RouteStatus.release,
  },
  "/skills": {
    route: "/skills",
    name: "Skills",
    icon: "pi pi-book",
    status: RouteStatus.release,
  },
  "/custom-tools": {
    route: "/custom-tools",
    name: "Custom Tools",
    icon: "pi pi-wrench",
    status: RouteStatus.release,
  },
  "/claude-cli": {
    route: "/claude-cli",
    name: "Claude CLI",
    icon: "pi pi-terminal",
    status: RouteStatus.development,
  },
  "/api-tester": {
    route: "/api-tester",
    name: "API Tester",
    icon: "pi pi-send",
    status: RouteStatus.release,
  },
  "/feature-feedback": {
    route: "/feature-feedback",
    name: "Feedback",
    icon: "pi pi-comments",
    status: RouteStatus.release,
  },
  "/notes": {
    route: "/notes",
    name: "Notes",
    icon: "pi pi-file-edit",
    status: RouteStatus.release,
  },
  "/multi-agent": {
    route: "/multi-agent",
    name: "Multi-Agent",
    icon: "pi pi-sitemap",
    status: RouteStatus.draft,
  },
  "/netsuite-agent-harness": {
    route: "/netsuite-agent-harness",
    name: "NetSuite Agent Harness",
    icon: "pi pi-compass",
    status: RouteStatus.draft,
  },
  "/netsuite-api-tester": {
    route: "/netsuite-api-tester",
    name: "NetSuite API Tester",
    icon: "pi pi-bolt",
    status: RouteStatus.release,
    adminOnly: true,
  },
} satisfies Record<string, NavigationView>;

/** Ignore stale preferences, detail routes and internal execution surfaces. */
export function getPreferredViews(preferred: unknown): NavigationView[] {
  const paths = new Set(Array.isArray(preferred) ? preferred : []);
  return (Object.values(navigationViews) as NavigationView[]).filter(
    (view) =>
      paths.has(view.route) &&
      !view.internalOnly &&
      view.status !== RouteStatus.deprecated &&
      !["/", "/settings"].includes(view.route),
  );
}
