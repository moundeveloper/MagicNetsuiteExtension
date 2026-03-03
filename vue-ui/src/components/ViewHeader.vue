<template>
  <div>
    <Breadcrumb :home="home" :model="breadcrumbs">
      <template #item="{ item, props }">
        <router-link
          v-if="item.route"
          v-slot="{ href, navigate }"
          :to="item.route"
          custom
        >
          <a :href="href" v-bind="props.action" @click="navigate">
            <span :class="[item.icon, 'text-color']" />
            <span class="text-primary font-semibold">{{ item.label }}</span>
          </a>
        </router-link>
        <a v-else v-bind="props.action">
          <span class="text-surface-700 dark:text-surface-0">{{
            item.label
          }}</span>
        </a>
      </template>
    </Breadcrumb>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import Breadcrumb from "primevue/breadcrumb";
import { routes } from "../router/routesMap";

const route = useRoute();

const home = {
  icon: "pi pi-home",
  route: "/"
};

const breadcrumbs = computed(() => {
  const currentPath = route.path;

  let foundRoute: any = routes.find((r) => r.route === currentPath);

  if (!foundRoute) {
    for (const r of routes) {
      if (r.children) {
        foundRoute = r.children.find((c: any) => {
          const routePattern = c.route.replace(/:[^/]+/g, "[^/]+");
          const regex = new RegExp(`^${routePattern}$`);
          return regex.test(currentPath);
        });
        if (foundRoute) break;
      }
    }
  }

  if (!foundRoute) {
    return [];
  }

  const items = [];

  if (foundRoute.breadcrumbParents) {
    for (const parent of foundRoute.breadcrumbParents) {
      items.push({
        label: parent.label,
        route: parent.route
      });
    }
  }

  items.push({
    label: foundRoute.breadcrumb || foundRoute.name
  });

  return items;
});
</script>

<style scoped></style>
