import CustomRecordsView from "../views/CustomRecordsView.vue";
import HomeView from "../views/HomeView.vue";
import ScriptsView from "../views/ScriptsView.vue";
import RequestScript from "../views/RequestScriptView.vue";
import RunQuickScriptView from "../views/RunQuickScriptView.vue";
import ScriptsDeployedView from "../views/ScriptsDeployedView.vue";
import ExportRecordView from "../views/ExportRecordView.vue";
import SettingsView from "../views/SettingsView.vue";
import LogSearchView from "../views/LogSearchView.vue";
import RequestSnifferView from "../views/RequestSnifferView.vue";
import BundleSearchView from "../views/BundleSearchView.vue";
import BetterFilecabinetView from "../views/BetterFilecabinetView.vue";
import PlaygroundView from "../views/PlaygroundView.vue";

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
};

export type Route = {
  route: string;
  component: any;
};

export const routes = [
  {
    route: "/",
    name: "Features",
    icon: "pi pi-home",
    component: HomeView,
    status: RouteStatus.release
  },
  {
    route: "/settings",
    name: "Settings",
    icon: "pi pi-cog",
    component: SettingsView,
    status: RouteStatus.release
  },
  {
    route: "/logs",
    name: "Logs",
    icon: "pi pi-file",
    component: LogSearchView,
    status: RouteStatus.release
  },
  {
    route: "/request-sniffer",
    name: "Request Sniffer",
    icon: "pi pi-receipt",
    component: RequestSnifferView,
    status: RouteStatus.draft
  },
  {
    route: "/bundles",
    name: "Bundles",
    icon: "pi pi-box",
    component: BundleSearchView,
    status: RouteStatus.draft
  },
  {
    route: "/better-filecabinet",
    name: "Better File Cabinet",
    icon: "pi pi-folder",
    component: BetterFilecabinetView,
    status: RouteStatus.development
  },
  {
    route: "/request-script",
    name: "Request Script",
    icon: "pi pi-globe",
    component: RequestScript,
    status: RouteStatus.draft
  },
  {
    route: "/custom-records",
    name: "Custom Records",
    icon: "pi pi-table",
    component: CustomRecordsView,
    status: RouteStatus.release
  },
  {
    route: "/scripts",
    name: "Scripts",
    icon: "pi pi-code",
    component: ScriptsView,
    status: RouteStatus.release
  },
  {
    route: "/playground",
    name: "Playground",
    icon: "pi-directions-alt",
    component: PlaygroundView,
    status: RouteStatus.development
  },
  {
    route: "/run-quick-script",
    name: "Run Quick Script",
    icon: "pi pi-file",
    component: RunQuickScriptView,
    status: RouteStatus.release
  },
  {
    route: "/scripts-deployed",
    name: "Scripts Deployed",
    icon: "pi pi-list",
    component: ScriptsDeployedView,
    status: RouteStatus.release
  },
  {
    route: "/export-record",
    name: "Export Record",
    icon: "pi pi-download",
    component: ExportRecordView,
    status: RouteStatus.fix
  }
];

export const getRouteMap = (): RouteItem[] => {
  return routes.map((route) => ({
    route: route.route,
    name: route.name,
    icon: route.icon,
    status: route.status
  }));
};

export const getRoutes = () => {
  return routes.map((route) => ({
    path: route.route,
    name: route.name,
    component: route.component
  }));
};
