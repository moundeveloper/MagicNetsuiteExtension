<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { useRoute } from "vue-router";
import type { RouteItem } from "../router/routesMap";
import { Button, Drawer, InputText } from "primevue";

const props = defineProps<{
  links: RouteItem[];
}>();

const route = useRoute();
const visibleBottom = ref(false);
const search = ref("");

const activeRoute = computed(() => route.path);

const filteredLinks = computed(() => {
  return props.links.filter((link) => {
    return link.name.toLowerCase().includes(search.value.toLowerCase());
  });
});

const handleKeydown = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (!visibleBottom.value) {
      visibleBottom.value = true;
    } else {
      visibleBottom.value = false;
    }
  }
};

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <Button
    icon="pi pi-arrow-up"
    @click="visibleBottom = true"
    label="Open Menu(Ctrl+K)"
    class="fixed m-4"
  />

  <Drawer
    v-model:visible="visibleBottom"
    header="Navigation Items"
    position="bottom"
    style="height: 70vh"
  >
    <div class="flex flex-col gap-4 h-full">
      <InputText v-model="search" placeholder="Search" autofocus="true" />

      <div
        class="grid [grid-template-columns:repeat(auto-fit,100px)] gap-8 p-2 overflow-y-auto"
      >
        <router-link
          v-for="link in filteredLinks"
          :key="link.route"
          :to="link.route"
          class="menu-item aspect-square flex flex-col items-center justify-center"
          :class="{ active: activeRoute === link.route }"
          @click="visibleBottom = false"
        >
          <i :class="link.icon" />
          <span class="text-center">{{ link.name }}</span>
        </router-link>
      </div>
    </div>
  </Drawer>
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
  outline: solid 1px var(--p-slate-600);
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
