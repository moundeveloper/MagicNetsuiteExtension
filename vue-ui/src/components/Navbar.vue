<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import type { RouteItem } from "../router/routesMap";

const props = defineProps<{
  links: RouteItem[];
}>();

const route = useRoute();

const activeRoute = computed(() => route.path);
</script>

<template>
  <nav class="menu-bar">
    <router-link
      v-for="link in links"
      :key="link.route"
      :to="link.route"
      class="menu-item"
      :class="{ active: activeRoute === link.route }"
    >
      <i :class="link.icon" />
      <span>{{ link.name }}</span>
    </router-link>
  </nav>
</template>

<style scoped>
.menu-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background: var(--surface-card);
  border-radius: 0.75rem;
}

/* Base link style */
.menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  text-decoration: none;
  font-weight: 500;
  color: #475569; /* slate-600 text */
  border-radius: 0.5rem;
  transition: background-color 0.25s, color 0.25s;
}

/* Hover: lighter slate tone */
.menu-item:hover {
  background-color: #e2e8f0; /* slate-200 */
  color: #1e293b; /* slate-800 */
}

/* Active: darker slate tone */
.menu-item.active {
  background-color: #cbd5e1; /* slate-300 */
  color: #0f172a; /* slate-900 */
  font-weight: 600;
}
</style>
