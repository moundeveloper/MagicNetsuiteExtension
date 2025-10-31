<script setup lang="ts">
import { reactive } from "vue";
import { useRouter } from "vue-router";
import Card from "primevue/card";
import { getRouteMap } from "../router/routesMap";

interface Feature {
  name: string;
  route: string;
  icon: string;
}

const router = useRouter();

const features: Feature[] = getRouteMap().filter(
  (route) => route.name.toLowerCase() !== "home"
);

const goTo = (route: string) => {
  router.push(route);
};
</script>

<template>
  <div class="wraper">
    <h1>FEATURES</h1>
    <div class="home-grid">
      <Card
        v-for="feature in features"
        :key="feature.route"
        class="feature-card"
        @click="goTo(feature.route)"
      >
        <template #title>
          <div class="feature-icon">
            <i :class="feature.icon"></i>
          </div>
        </template>
        <template #content>
          <div class="feature-name">{{ feature.name }}</div>
        </template>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.wraper {
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.p-card {
  background-color: var(--p-slate-200) !important;
}

.home-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 1.5rem;
}

.feature-card {
  cursor: pointer;
  text-align: center;
  transition: transform 0.2s, box-shadow 0.2s;
}

.feature-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
}

.feature-icon i {
  font-size: 2rem;
  color: var(--primary-color);
}

.feature-name {
  font-weight: 600;
  font-size: 1rem;
  margin-top: 0.5rem;
}

.feature-description {
  margin-top: 0.75rem;
  font-size: 0.875rem;
  color: var(--text-color-secondary);
}
</style>
