<template>
  <div>Playground</div>

  <MCard flex autoHeight padding="1rem" outlined elevated class="mt-4">
    <MInput
      v-model="inputValue"
      placeholder="Enter something..."
      outlined
      item-dynamic
    />
  </MCard>
</template>

<script setup lang="ts">
import { ref } from "vue";
import MCard from "../components/universal/card/MCard.vue";
import MInput from "../components/universal/input/MInput.vue";

defineProps<{ vhOffset: number }>();

const inputValue = ref("");
</script>
