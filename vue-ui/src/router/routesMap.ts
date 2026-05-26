import CustomRecordsView from "../views/CustomRecordsView.vue";
import HomeView from "../views/HomeView.vue";
import ScriptsView from "../views/ScriptsView.vue";
import ScriptDetailView from "../views/ScriptDetailView.vue";
import RequestScript from "../views/RequestScriptView.vue";
import RunQuickScriptView from "../views/RunQuickScriptView.vue";
import ExportRecordView from "../views/ExportRecordView.vue";
import SettingsView from "../views/SettingsView.vue";
import LogSearchView from "../views/LogSearchView.vue";
import RequestSnifferView from "../views/RequestSnifferView.vue";
import BundleSearchView from "../views/BundleSearchView.vue";
import BundleDetailView from "../views/BundleDetailView.vue";
import BetterFilecabinetView from "../views/BetterFilecabinetView.vue";
import PlaygroundView from "../views/PlaygroundView.vue";
import ScriptsDeployedView from "../views/ScriptsDeployedView.vue";
import ProcessingView from "../views/ProcessingView.vue";
import TemplatesView from "../views/TemplatesView.vue";
import TemplateDetailView from "../views/TemplateDetailView.vue";
import SuiteScriptModulesView from "../views/SuiteScriptModulesView.vue";
import SuiteQLView from "../views/SuiteQLView.vue";
import McpServerView from "../views/McpServerView.vue";
import ApiTesterView from "../views/ApiTesterView.vue";
import MultiAgentView from "../views/MultiAgentView.vue";
import NetsuiteApiTesterView from "../views/NetsuiteApiTesterView.vue";
import NetsuiteAgentHarnessView from "../views/NetsuiteAgentHarnessView.vue";

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
  breadcrumbParents?: Array<{ label: string; route: string }>;
  adminOnly?: boolean;
};

export type Route = {
  route: string;
  component: any;
  children?: Array<{
    route: string;
    name: string;
    component: any;
    breadcrumb?: string;
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
    route: "/request-sniffer",
    name: "Request Sniffer",
    icon: "pi pi-receipt",
    component: RequestSnifferView,
    status: RouteStatus.draft,
    breadcrumb: "Request Sniffer"
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
    route: "/request-script",
    name: "Request Script",
    icon: "pi pi-globe",
    component: RequestScript,
    status: RouteStatus.draft,
    breadcrumb: "Request Script"
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
    route: "/export-record",
    name: "Export Record",
    icon: "pi pi-download",
    component: ExportRecordView,
    status: RouteStatus.fix,
    breadcrumb: "Export Record"
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
    route: "/processing",
    name: "Processing",
    icon: "pi pi-spinner",
    component: ProcessingView,
    status: RouteStatus.draft,
    breadcrumb: "Processing"
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
    route: "/api-tester",
    name: "API Tester",
    icon: "pi pi-send",
    component: ApiTesterView,
    status: RouteStatus.release,
    breadcrumb: "API Tester"
  },
  {
    route: "/multi-agent",
    name: "Multi-Agent",
    icon: "pi pi-sitemap",
    component: MultiAgentView,
    status: RouteStatus.release,
    breadcrumb: "Multi-Agent"
  },
  {
    route: "/netsuite-agent-harness",
    name: "NetSuite Agent Harness",
    icon: "pi pi-compass",
    component: NetsuiteAgentHarnessView,
    status: RouteStatus.release,
    breadcrumb: "NetSuite Agent Harness",
    children: [
      {
        route: "/netsuite-agent-harness/agents",
        name: "HarnessAgents",
        component: NetsuiteAgentHarnessView,
        breadcrumb: "Agents",
        breadcrumbParents: [{ label: "NetSuite Agent Harness", route: "/netsuite-agent-harness" }]
      },
      {
        route: "/netsuite-agent-harness/skills",
        name: "HarnessSkills",
        component: NetsuiteAgentHarnessView,
        breadcrumb: "Skills",
        breadcrumbParents: [{ label: "NetSuite Agent Harness", route: "/netsuite-agent-harness" }]
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
    adminOnly: route.adminOnly
  }));
};

export const getRoutes = () => {
  const result: any[] = [];

  for (const route of routes) {
    const baseRoute = {
      path: route.route,
      name: route.name,
      component: route.component
    };

    result.push(baseRoute);

    if (route.children) {
      for (const child of route.children) {
        result.push({
          path: child.route,
          name: child.name,
          component: child.component
        });
      }
    }
  }

  return result;
};
