import { navigationViews, RouteStatus } from "../../../shared/navigationViews";
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

const CustomRecordsView = lazyView(
  () => import("../views/CustomRecordsView.vue"),
);
const HomeView = lazyView(() => import("../views/HomeView.vue"));
const ScriptsView = lazyView(() => import("../views/ScriptsView.vue"));
const ScriptDetailView = lazyView(
  () => import("../views/ScriptDetailView.vue"),
);
const RunQuickScriptView = lazyView(
  () => import("../views/RunQuickScriptView.vue"),
);
const SettingsView = lazyView(() => import("../views/SettingsView.vue"));
const LogSearchView = lazyView(() => import("../views/LogSearchView.vue"));
const BundleSearchView = lazyView(
  () => import("../views/BundleSearchView.vue"),
);
const BundleDetailView = lazyView(
  () => import("../views/BundleDetailView.vue"),
);
const BundleSdfProjectView = lazyView(
  () => import("../views/BundleSdfProjectView.vue"),
);
const BetterFilecabinetView = lazyView(
  () => import("../views/BetterFilecabinetView.vue"),
);
const PlaygroundView = lazyView(() => import("../views/PlaygroundView.vue"));
const ScriptsDeployedView = lazyView(
  () => import("../views/ScriptsDeployedView.vue"),
);
const ProcessingView = lazyView(() => import("../views/ProcessingView.vue"));
const JobsCenterView = lazyView(() => import("../views/JobsCenterView.vue"));
const NetsuiteQuizView = lazyView(
  () => import("../views/NetsuiteQuizView.vue"),
);
const TemplatesView = lazyView(() => import("../views/TemplatesView.vue"));
const TemplateDetailView = lazyView(
  () => import("../views/TemplateDetailView.vue"),
);
const SuiteScriptModulesView = lazyView(
  () => import("../views/SuiteScriptModulesView.vue"),
);
const SuiteQLView = lazyView(() => import("../views/SuiteQLView.vue"));
const McpServerView = lazyView(() => import("../views/McpServerView.vue"));
const ApiTesterView = lazyView(() => import("../views/ApiTesterView.vue"));
const MultiAgentView = lazyView(() => import("../views/MultiAgentView.vue"));
const NetsuiteApiTesterView = lazyView(
  () => import("../views/NetsuiteApiTesterView.vue"),
);
const NetsuiteAgentHarnessView = lazyView(
  () => import("../views/NetsuiteAgentHarnessView.vue"),
);
const FeatureFeedbackView = lazyView(
  () => import("../views/FeatureFeedbackView.vue"),
);
const NotesView = lazyView(() => import("../features/notes/NotesView.vue"));
const FreemarkerRendererView = lazyView(
  () => import("../views/FreemarkerRendererView.vue"),
);
const TemplateStudioView = lazyView(
  () => import("../views/TemplateStudioView.vue"),
);
const RecordsView = lazyView(() => import("../views/RecordsView.vue"));
const RecordDetailView = lazyView(
  () => import("../views/RecordDetailView.vue"),
);
const FlightRecorderView = lazyView(
  () => import("../views/FlightRecorderView.vue"),
);
const WatchtowerView = lazyView(() => import("../views/WatchtowerView.vue"));
const DependencyExplorerView = lazyView(
  () => import("../views/DependencyExplorerView.vue"),
);
const ArchitectureWorkbenchView = lazyView(
  () => import("../views/ArchitectureWorkbenchView.vue"),
);
const SkillsView = lazyView(() => import("../views/SkillsView.vue"));
const CustomToolsView = lazyView(() => import("../views/CustomToolsView.vue"));
const DashboardsView = lazyView(() => import("../views/DashboardsView.vue"));
const DashboardView = lazyView(() => import("../views/DashboardView.vue"));
const ClaudeTasksView = lazyView(() => import("../views/ClaudeTasksView.vue"));
const DownloadAnalyzerView = lazyView(
  () => import("../views/DownloadAnalyzerView.vue"),
);

export { RouteStatus } from "../../../shared/navigationViews";

export const RouteStatusColors = {
  [RouteStatus.development]: "#C3BEF7",
  [RouteStatus.fix]: "#EF8354",
  [RouteStatus.draft]: "#73BA9B",
  [RouteStatus.deprecated]: "#dc2626",
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
    ...navigationViews["/dashboards"],
    component: DashboardsView,
    breadcrumb: "Dashboards",
  },
  {
    ...navigationViews["/"],
    component: HomeView,
    breadcrumb: "Features",
  },
  {
    ...navigationViews["/settings"],
    component: SettingsView,
    breadcrumb: "Settings",
  },
  {
    ...navigationViews["/logs"],
    component: LogSearchView,
    breadcrumb: "Logs",
  },
  {
    ...navigationViews["/flight-recorder"],
    component: FlightRecorderView,
    breadcrumb: "Flight Recorder",
  },
  {
    ...navigationViews["/watchtower"],
    component: WatchtowerView,
    breadcrumb: "Record History",
  },
  {
    ...navigationViews["/architecture-workbench"],
    component: ArchitectureWorkbenchView,
    breadcrumb: "Architecture Workbench",
  },
  {
    ...navigationViews["/dependency-explorer"],
    component: DependencyExplorerView,
    breadcrumb: "Dependency Explorer",
  },
  {
    ...navigationViews["/download-analyzer"],
    component: DownloadAnalyzerView,
    breadcrumb: "Download Analyzer",
  },
  {
    ...navigationViews["/bundles"],
    component: BundleSearchView,
    breadcrumb: "Bundles",
    children: [
      {
        route: "/bundles/:bundleId",
        name: "BundleDetail",
        component: BundleDetailView,
        breadcrumb: "Bundle Detail",
        breadcrumbParents: [{ label: "Bundles", route: "/bundles" }],
      },
      {
        route: "/bundles/:bundleId/sdf",
        name: "BundleSdfProject",
        component: BundleSdfProjectView,
        breadcrumb: "SDF Project",
        tabLabel: "SDF Project",
        breadcrumbParents: [{ label: "Bundles", route: "/bundles" }],
      },
    ],
  },
  {
    ...navigationViews["/better-filecabinet"],
    component: BetterFilecabinetView,
    breadcrumb: "Better File Cabinet",
  },
  {
    ...navigationViews["/custom-records"],
    component: CustomRecordsView,
    breadcrumb: "Custom Records",
  },
  {
    ...navigationViews["/records"],
    component: RecordsView,
    breadcrumb: "Records",
    children: [
      {
        route: "/records/:recordType/:recordId",
        name: "RecordDetail",
        component: RecordDetailView,
        breadcrumb: "Record Detail",
        breadcrumbParents: [{ label: "Records", route: "/records" }],
      },
    ],
  },
  {
    ...navigationViews["/scripts"],
    component: ScriptsView,
    breadcrumb: "Scripts",
    children: [
      {
        route: "/scripts/:scriptId",
        name: "ScriptDetail",
        component: ScriptDetailView,
        breadcrumb: "Script Detail",
        breadcrumbParents: [{ label: "Scripts", route: "/scripts" }],
      },
    ],
  },
  {
    ...navigationViews["/playground"],
    component: PlaygroundView,
    breadcrumb: "Playground",
  },
  {
    ...navigationViews["/run-quick-script"],
    component: RunQuickScriptView,
    breadcrumb: "Run Quick Script",
  },
  {
    ...navigationViews["/scripts-deployed"],
    component: ScriptsDeployedView,
    breadcrumb: "Scripts Deployed",
  },
  {
    ...navigationViews["/templates"],
    component: TemplatesView,
    breadcrumb: "Templates",
    children: [
      {
        route: "/templates/:id",
        name: "TemplateDetail",
        component: TemplateDetailView,
        breadcrumb: "Template Detail",
        breadcrumbParents: [{ label: "Templates", route: "/templates" }],
      },
    ],
  },
  {
    ...navigationViews["/freemarker-renderer"],
    component: FreemarkerRendererView,
    breadcrumb: "FreeMarker Renderer",
  },
  {
    ...navigationViews["/template-studio"],
    component: TemplateStudioView,
    breadcrumb: "Collaborative FreeMarker Sessions",
  },
  {
    ...navigationViews["/processing"],
    component: ProcessingView,
    breadcrumb: "Execution Monitor",
  },
  {
    ...navigationViews["/jobs"],
    component: JobsCenterView,
    breadcrumb: "Jobs Center",
  },
  {
    ...navigationViews["/quiz"],
    component: NetsuiteQuizView,
    breadcrumb: "NetSuite Quiz",
  },
  {
    ...navigationViews["/suitescript-modules"],
    component: SuiteScriptModulesView,
    breadcrumb: "SuiteScript Modules",
  },
  {
    ...navigationViews["/suiteql"],
    component: SuiteQLView,
    breadcrumb: "SuiteQL Editor",
  },
  {
    ...navigationViews["/mcp-server"],
    component: McpServerView,
    breadcrumb: "MCP Server",
  },
  {
    ...navigationViews["/skills"],
    component: SkillsView,
    breadcrumb: "Skills",
  },
  {
    ...navigationViews["/custom-tools"],
    component: CustomToolsView,
    breadcrumb: "Custom Tools",
  },
  {
    ...navigationViews["/claude-cli"],
    component: ClaudeTasksView,
    breadcrumb: "Claude CLI",
  },
  {
    ...navigationViews["/api-tester"],
    component: ApiTesterView,
    breadcrumb: "API Tester",
  },
  {
    ...navigationViews["/feature-feedback"],
    component: FeatureFeedbackView,
    breadcrumb: "Feedback",
  },
  {
    ...navigationViews["/notes"],
    component: NotesView,
    breadcrumb: "Notes",
    children: [
      {
        route: "/notes/page/:id",
        name: "notes-page",
        component: NotesView,
        breadcrumb: "Page",
        tabLabel: "Notes",
        breadcrumbParents: [{ label: "Notes", route: "/notes" }],
      },
    ],
  },
  {
    ...navigationViews["/multi-agent"],
    component: MultiAgentView,
    breadcrumb: "Multi-Agent",
  },
  {
    ...navigationViews["/netsuite-agent-harness"],
    component: NetsuiteAgentHarnessView,
    breadcrumb: "NetSuite Agent Harness",
    children: [
      {
        route: "/netsuite-agent-harness/agents",
        name: "HarnessAgents",
        component: NetsuiteAgentHarnessView,
        breadcrumb: "Agents",
        breadcrumbParents: [
          { label: "NetSuite Agent Harness", route: "/netsuite-agent-harness" },
        ],
      },
      {
        route: "/netsuite-agent-harness/skills",
        name: "HarnessSkills",
        component: NetsuiteAgentHarnessView,
        breadcrumb: "Skills",
        breadcrumbParents: [
          { label: "NetSuite Agent Harness", route: "/netsuite-agent-harness" },
        ],
      },
    ],
  },
  {
    ...navigationViews["/netsuite-api-tester"],
    component: NetsuiteApiTesterView,
    breadcrumb: "NetSuite API Tester",
  },
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
    internalOnly: route.internalOnly,
  }));
};

export const isRouteVisibleInNavigation = (
  route: Pick<RouteItem, "internalOnly">,
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
        internalOnly: Boolean(route.internalOnly),
      },
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
            internalOnly: Boolean(route.internalOnly),
          },
        });
      }
    }
  }

  result.push({
    path: "/dashboard/:dashboardId",
    name: "SavedDashboard",
    component: DashboardView,
    meta: { internalOnly: true },
  });
  return result;
};
