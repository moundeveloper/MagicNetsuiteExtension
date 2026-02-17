<script setup lang="ts">
import MLoader from "../components/universal/patterns/MLoader.vue";
import GridPattern from "../components/universal/patterns/GridPattern.vue";
</script>

<template>
  <div class="processing-container">
    <GridPattern class="pattern-bg" />
    <div class="content">
      <MLoader />
      <p class="text">Nothing to see here</p>
    </div>
  </div>
</template>

<style scoped>
.processing-container {
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
}

.pattern-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.content {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
}

.text {
  color: var(--p-slate-600);
  font-size: 1.25rem;
  font-family: var(--font-mono);
  letter-spacing: 0.05em;
}
</style>
