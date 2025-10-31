import CustomRecordsView from "../views/CustomRecordsView.vue";
import HomeView from "../views/HomeView.vue";
import ScriptsView from "../views/ScriptsView.vue";
import RequestScript from "../views/RequestScriptView.vue";
import RunQuickScriptView from "../views/RunQuickScriptView.vue";
import ScriptsDeployedView from "../views/ScriptsDeployedView.vue";
import ExportRecordView from "../views/ExportRecordView.vue";

export type RouteItem = {
  route: string;
  name: string;
  icon: string;
};

export type Route = {
  route: string;
  component: any;
};

export const routes = [
  { route: "/", name: "Home", icon: "pi pi-home", component: HomeView },
  {
    route: "/request-script",
    name: "Request Script",
    icon: "pi pi-globe",
    component: RequestScript,
  },
  {
    route: "/custom-records",
    name: "Custom Records",
    icon: "pi pi-table",
    component: CustomRecordsView,
  },
  {
    route: "/scripts",
    name: "Scripts",
    icon: "pi pi-code",
    component: ScriptsView,
  },
  {
    route: "/run-quick-script",
    name: "Run Quick Script",
    icon: "pi pi-file",
    component: RunQuickScriptView,
  },
  {
    route: "/scripts-deployed",
    name: "Scripts Deployed",
    icon: "pi pi-list",
    component: ScriptsDeployedView,
  },
  {
    route: "/export-record",
    name: "Export Record",
    icon: "pi pi-download",
    component: ExportRecordView,
  },
];

export const getRouteMap = (): RouteItem[] => {
  return routes.map((route) => ({
    route: route.route,
    name: route.name,
    icon: route.icon,
  }));
};

export const getRoutes = () => {
  return routes.map((route) => ({
    path: route.route,
    name: route.name,
    component: route.component,
  }));
};
