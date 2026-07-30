import { defineAsyncComponent, markRaw, type Component } from "vue";

type ViewModule = { default: Component };
type ViewLoader = () => Promise<ViewModule>;

/**
 * Vue Router accepts raw import functions, but ViewTabsWorkspace renders route
 * components manually with <component :is>. A raw loader is treated there as a
 * functional component and its Promise becomes visible text ("[object Promise]").
 * Always wrap route loaders so both rendering paths receive a real component.
 */
const lazyView = (loader: ViewLoader): Component =>
  markRaw(defineAsyncComponent(loader));

const CustomRecordsView = lazyView(() => import("../views/CustomRecordsView.vue"));
const HomeView = lazyView(() => import("../views/HomeView.vue"));
const ScriptsView = lazyView(() => import("../views/ScriptsView.vue"));
const ScriptDetailView = lazyView(() => import("../views/ScriptDetailView.vue"));
const RunQuickScriptView = lazyView(() => import("../views/RunQuickScriptView.vue"));
const SettingsView = lazyView(() => import("../views/SettingsView.vue"));
const LogSearchView = lazyView(() => import("../views/LogSearchView.vue"));
const BundleSearchView = lazyView(() => import("../views/BundleSearchView.vue"));
const BundleDetailView = lazyView(() => import("../views/BundleDetailView.vue"));
const BundleSdfProjectView = lazyView(() =>
  import("../views/BundleSdfProjectView.vue")
);
const BetterFilecabinetView = lazyView(() =>
  import("../views/BetterFilecabinetView.vue")
);
const PlaygroundView = lazyView(() => import("../views/PlaygroundView.vue"));
const ScriptsDeployedView = lazyView(() =>
  import("../views/ScriptsDeployedView.vue")
);
const ProcessingView = lazyView(() => import("../views/ProcessingView.vue"));
const JobsCenterView = lazyView(() => import("../views/JobsCenterView.vue"));
const TemplatesView = lazyView(() => import("../views/TemplatesView.vue"));
const TemplateDetailView = lazyView(() =>
  import("../views/TemplateDetailView.vue")
);
const SuiteScriptModulesView = lazyView(() =>
  import("../views/SuiteScriptModulesView.vue")
);
const SuiteQLView = lazyView(() => import("../views/SuiteQLView.vue"));
const McpServerView = lazyView(() => import("../views/McpServerView.vue"));
const ApiTesterView = lazyView(() => import("../views/ApiTesterView.vue"));
const MultiAgentView = lazyView(() => import("../views/MultiAgentView.vue"));
const NetsuiteApiTesterView = lazyView(() =>
  import("../views/NetsuiteApiTesterView.vue")
);
const NetsuiteAgentHarnessView = lazyView(() =>
  import("../views/NetsuiteAgentHarnessView.vue")
);
const FeatureFeedbackView = lazyView(() =>
  import("../views/FeatureFeedbackView.vue")
);
const NotesView = lazyView(() => import("../features/notes/NotesView.vue"));
const FreemarkerRendererView = lazyView(() =>
  import("../views/FreemarkerRendererView.vue")
);
const TemplateStudioView = lazyView(() =>
  import("../views/TemplateStudioView.vue")
);
const RecordsView = lazyView(() => import("../views/RecordsView.vue"));
const RecordDetailView = lazyView(() => import("../views/RecordDetailView.vue"));
const FlightRecorderView = lazyView(() =>
  import("../views/FlightRecorderView.vue")
);
const WatchtowerView = lazyView(() => import("../views/WatchtowerView.vue"));
const DependencyExplorerView = lazyView(() =>
  import("../views/DependencyExplorerView.vue")
);
const SkillsView = lazyView(() => import("../views/SkillsView.vue"));
const CustomToolsView = lazyView(() => import("../views/CustomToolsView.vue"));
const ClaudeTasksView = lazyView(() => import("../views/ClaudeTasksView.vue"));
const DownloadAnalyzerView = lazyView(() =>
  import("../views/DownloadAnalyzerView.vue")
);

export enum RouteStatus {
  development = "development",
  fix = "fix",
  draft = "draft",
  release = "release",
  deprecated = "deprecated"
}

export const RouteStatusColors = {
  [RouteStatus.development]: "#C3BEF7",
  [RouteStatus.fix]: "#EF8354",
  [RouteStatus.draft]: "#73BA9B",
  [RouteStatus.deprecated]: "#dc2626"
};

export type RouteItem = {
  route: string;
  name: string;
  icon: string;
  status: RouteStatus;
  breadcrumb?: string;
  tabLabel?: string;
  breadcrumbParents?: Array<{ label: string; route: string }>;
  adminOnly?: boolean;
  internalOnly?: boolean;
};

export type Route = {
  route: string;
  component: any;
  children?: Array<{
    route: string;
    name: string;
    component: any;
    breadcrumb?: string;
    tabLabel?: string;
    breadcrumbParents?: Array<{ label: string; route: string }>;
  }>;
};

type FullRoute = RouteItem & {
  component: any;
  children?: Array<{
    route: string;
    name: string;
    component: any;
    breadcrumb?: string;
    tabLabel?: string;
    breadcrumbParents?: Array<{ label: string; route: string }>;
  }>;
};

export const routes: FullRoute[] = [
  {
    route: "/",
    name: "Features",
    icon: "pi pi-home",
    component: HomeView,
    status: RouteStatus.release,
    breadcrumb: "Features"
  },
  {
    route: "/settings",
    name: "Settings",
    icon: "pi pi-cog",
    component: SettingsView,
    status: RouteStatus.release,
    breadcrumb: "Settings"
  },
  {
    route: "/logs",
    name: "Logs",
    icon: "pi pi-file",
    component: LogSearchView,
    status: RouteStatus.release,
    breadcrumb: "Logs"
  },
  {
    route: "/flight-recorder",
    name: "Flight Recorder",
    icon: "pi pi-wave-pulse",
    component: FlightRecorderView,
    status: RouteStatus.release,
    breadcrumb: "Flight Recorder",
    adminOnly: true
  },
  {
    route: "/watchtower",
    name: "Record History",
    icon: "pi pi-history",
    component: WatchtowerView,
    status: RouteStatus.release,
    breadcrumb: "Record History"
  },
  {
    route: "/dependency-explorer",
    name: "Dependency Explorer",
    icon: "pi pi-share-alt",
    component: DependencyExplorerView,
    status: RouteStatus.release,
    breadcrumb: "Dependency Explorer"
  },
  {
    route: "/download-analyzer",
    name: "Download Analyzer",
    icon: "pi pi-download",
    component: DownloadAnalyzerView,
    status: RouteStatus.release,
    breadcrumb: "Download Analyzer"
  },
  {
    route: "/bundles",
    name: "Bundles",
    icon: "pi pi-box",
    component: BundleSearchView,
    status: RouteStatus.release,
    breadcrumb: "Bundles",
    children: [
      {
        route: "/bundles/:bundleId",
        name: "BundleDetail",
        component: BundleDetailView,
        breadcrumb: "Bundle Detail",
        breadcrumbParents: [{ label: "Bundles", route: "/bundles" }]
      },
      {
        route: "/bundles/:bundleId/sdf",
        name: "BundleSdfProject",
        component: BundleSdfProjectView,
        breadcrumb: "SDF Project",
        tabLabel: "SDF Project",
        breadcrumbParents: [{ label: "Bundles", route: "/bundles" }]
      }
    ]
  },
  {
    route: "/better-filecabinet",
    name: "Better File Cabinet",
    icon: "pi pi-folder",
    component: BetterFilecabinetView,
    status: RouteStatus.release,
    breadcrumb: "Better File Cabinet"
  },
  {
    route: "/custom-records",
    name: "Custom Records",
    icon: "pi pi-table",
    component: CustomRecordsView,
    status: RouteStatus.release,
    breadcrumb: "Custom Records"
  },
  {
    route: "/records",
    name: "Records",
    icon: "pi pi-database",
    component: RecordsView,
    status: RouteStatus.release,
    breadcrumb: "Records",
    children: [
      {
        route: "/records/:recordType/:recordId",
        name: "RecordDetail",
        component: RecordDetailView,
        breadcrumb: "Record Detail",
        breadcrumbParents: [{ label: "Records", route: "/records" }]
      }
    ]
  },
  {
    route: "/scripts",
    name: "Scripts",
    icon: "pi pi-code",
    component: ScriptsView,
    status: RouteStatus.release,
    breadcrumb: "Scripts",
    children: [
      {
        route: "/scripts/:scriptId",
        name: "ScriptDetail",
        component: ScriptDetailView,
        breadcrumb: "Script Detail",
        breadcrumbParents: [{ label: "Scripts", route: "/scripts" }]
      }
    ]
  },
  {
    route: "/playground",
    name: "Playground",
    icon: "pi-directions-alt",
    component: PlaygroundView,
    status: RouteStatus.development,
    breadcrumb: "Playground"
  },
  {
    route: "/run-quick-script",
    name: "Run Quick Script",
    icon: "pi pi-file-export",
    component: RunQuickScriptView,
    status: RouteStatus.release,
    breadcrumb: "Run Quick Script"
  },
  {
    route: "/scripts-deployed",
    name: "Scripts Deployed",
    icon: "pi pi-list",
    component: ScriptsDeployedView,
    status: RouteStatus.release,
    breadcrumb: "Scripts Deployed"
  },
  {
    route: "/templates",
    name: "Templates",
    icon: "pi pi-file-pdf",
    component: TemplatesView,
    status: RouteStatus.release,
    breadcrumb: "Templates",
    children: [
      {
        route: "/templates/:id",
        name: "TemplateDetail",
        component: TemplateDetailView,
        breadcrumb: "Template Detail",
        breadcrumbParents: [{ label: "Templates", route: "/templates" }]
      }
    ]
  },
  {
    route: "/freemarker-renderer",
    name: "FreeMarker Renderer",
    icon: "pi pi-eye",
    component: FreemarkerRendererView,
    status: RouteStatus.release,
    breadcrumb: "FreeMarker Renderer"
  },
  {
    route: "/template-studio",
    name: "Template Studio",
    icon: "pi pi-sparkles",
    component: TemplateStudioView,
    status: RouteStatus.release,
    breadcrumb: "Collaborative FreeMarker Sessions"
  },
  {
    route: "/processing",
    name: "Execution Monitor",
    icon: "pi pi-bolt",
    component: ProcessingView,
    status: RouteStatus.release,
    breadcrumb: "Execution Monitor",
    internalOnly: true
  },
  {
    route: "/jobs",
    name: "Jobs Center",
    icon: "pi pi-list-check",
    component: JobsCenterView,
    status: RouteStatus.release,
    breadcrumb: "Jobs Center"
  },
  {
    route: "/suitescript-modules",
    name: "SuiteScript Modules",
    icon: "pi pi-database",
    component: SuiteScriptModulesView,
    status: RouteStatus.release,
    breadcrumb: "SuiteScript Modules"
  },
  {
    route: "/suiteql",
    name: "SuiteQL Editor",
    icon: "pi pi-server",
    component: SuiteQLView,
    status: RouteStatus.release,
    breadcrumb: "SuiteQL Editor"
  },
  {
    route: "/mcp-server",
    name: "MCP Server",
    icon: "pi pi-link",
    component: McpServerView,
    status: RouteStatus.release,
    breadcrumb: "MCP Server"
  },
  {
    route: "/skills",
    name: "Skills",
    icon: "pi pi-book",
    component: SkillsView,
    status: RouteStatus.release,
    breadcrumb: "Skills"
  },
  {
    route: "/custom-tools",
    name: "Custom Tools",
    icon: "pi pi-wrench",
    component: CustomToolsView,
    status: RouteStatus.release,
    breadcrumb: "Custom Tools"
  },
  {
    route: "/claude-cli",
    name: "Claude CLI",
    icon: "pi pi-terminal",
    component: ClaudeTasksView,
    status: RouteStatus.development,
    breadcrumb: "Claude CLI"
  },
  {
    route: "/api-tester",
    name: "API Tester",
    icon: "pi pi-send",
    component: ApiTesterView,
    status: RouteStatus.release,
    breadcrumb: "API Tester"
  },
  {
    route: "/feature-feedback",
    name: "Feedback",
    icon: "pi pi-comments",
    component: FeatureFeedbackView,
    status: RouteStatus.release,
    breadcrumb: "Feedback"
  },
  {
    route: "/notes",
    name: "Notes",
    icon: "pi pi-file-edit",
    component: NotesView,
    status: RouteStatus.release,
    breadcrumb: "Notes",
    children: [
      {
        route: "/notes/page/:id",
        name: "notes-page",
        component: NotesView,
        breadcrumb: "Page",
        tabLabel: "Notes",
        breadcrumbParents: [{ label: "Notes", route: "/notes" }]
      }
    ]
  },
  {
    route: "/multi-agent",
    name: "Multi-Agent",
    icon: "pi pi-sitemap",
    component: MultiAgentView,
    status: RouteStatus.draft,
    breadcrumb: "Multi-Agent"
  },
  {
    route: "/netsuite-agent-harness",
    name: "NetSuite Agent Harness",
    icon: "pi pi-compass",
    component: NetsuiteAgentHarnessView,
    status: RouteStatus.draft,
    breadcrumb: "NetSuite Agent Harness",
    children: [
      {
        route: "/netsuite-agent-harness/agents",
        name: "HarnessAgents",
        component: NetsuiteAgentHarnessView,
        breadcrumb: "Agents",
        breadcrumbParents: [
          { label: "NetSuite Agent Harness", route: "/netsuite-agent-harness" }
        ]
      },
      {
        route: "/netsuite-agent-harness/skills",
        name: "HarnessSkills",
        component: NetsuiteAgentHarnessView,
        breadcrumb: "Skills",
        breadcrumbParents: [
          { label: "NetSuite Agent Harness", route: "/netsuite-agent-harness" }
        ]
      }
    ]
  },
  {
    route: "/netsuite-api-tester",
    name: "NetSuite API Tester",
    icon: "pi pi-bolt",
    component: NetsuiteApiTesterView,
    status: RouteStatus.release,
    breadcrumb: "NetSuite API Tester",
    adminOnly: true
  }
];

export const getRouteMap = (): RouteItem[] => {
  return routes.map((route) => ({
    route: route.route,
    name: route.name,
    icon: route.icon,
    status: route.status,
    breadcrumb: route.breadcrumb,
    breadcrumbParents: route.breadcrumbParents,
    adminOnly: route.adminOnly,
    internalOnly: route.internalOnly
  }));
};

export const isRouteVisibleInNavigation = (
  route: Pick<RouteItem, "internalOnly">
) => !route.internalOnly;

export const getRoutes = () => {
  const result: any[] = [];

  for (const route of routes) {
    const baseRoute = {
      path: route.route,
      name: route.name,
      component: route.component,
      meta: {
        adminOnly: Boolean(route.adminOnly),
        internalOnly: Boolean(route.internalOnly)
      }
    };

    result.push(baseRoute);

    if (route.children) {
      for (const child of route.children) {
        result.push({
          path: child.route,
          name: child.name,
          component: child.component,
          meta: {
            adminOnly: Boolean(route.adminOnly),
            internalOnly: Boolean(route.internalOnly)
          }
        });
      }
    }
  }

  return result;
};
