import CustomRecordsView from "../views/CustomRecordsView.vue";
import HomeView from "../views/HomeView.vue";
import ScriptsView from "../views/ScriptsView.vue";
import RequestScript from "../views/RequestScriptView.vue";
import RunQuickScriptView from "../views/RunQuickScriptView.vue";
import ExportRecordView from "../views/ExportRecordView.vue";
import SettingsView from "../views/SettingsView.vue";
import LogSearchView from "../views/LogSearchView.vue";
import RequestSnifferView from "../views/RequestSnifferView.vue";
import BundleSearchView from "../views/BundleSearchView.vue";
import BetterFilecabinetView from "../views/BetterFilecabinetView.vue";
import PlaygroundView from "../views/PlaygroundView.vue";
import ScriptsDeployedView from "../views/ScriptsDeployedView.vue";
import ProcessingView from "../views/ProcessingView.vue";
import TemplatesView from "../views/TemplatesView.vue";
import TemplateDetailView from "../views/TemplateDetailView.vue";
import AiAssistantView from "../views/AiAssistantView.vue";
import SkillsView from "../views/SkillsView.vue";
import SuiteScriptModulesView from "../views/SuiteScriptModulesView.vue";

export enum RouteStatus {
  development = "development",
  fix = "fix",
  draft = "draft",
  release = "release"
}

export const RouteStatusColors = {
  [RouteStatus.development]: "#C3BEF7",
  [RouteStatus.fix]: "#EF8354",
  [RouteStatus.draft]: "#73BA9B"
};

export type RouteItem = {
  route: string;
  name: string;
  icon: string;
  status: RouteStatus;
  breadcrumb?: string;
  breadcrumbParents?: Array<{ label: string; route: string }>;
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
    status: RouteStatus.draft,
    breadcrumb: "Bundles"
  },
  {
    route: "/better-filecabinet",
    name: "Better File Cabinet",
    icon: "pi pi-folder",
    component: BetterFilecabinetView,
    status: RouteStatus.development,
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
    breadcrumb: "Scripts"
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
    route: "/ai-assistant",
    name: "AI Assistant",
    icon: "pi pi-comments",
    component: AiAssistantView,
    status: RouteStatus.release,
    breadcrumb: "AI Assistant"
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
    route: "/suitescript-modules",
    name: "SuiteScript Modules",
    icon: "pi pi-database",
    component: SuiteScriptModulesView,
    status: RouteStatus.release,
    breadcrumb: "SuiteScript Modules"
  }
];

export const getRouteMap = (): RouteItem[] => {
  return routes.map((route) => ({
    route: route.route,
    name: route.name,
    icon: route.icon,
    status: route.status,
    breadcrumb: route.breadcrumb,
    breadcrumbParents: route.breadcrumbParents
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
