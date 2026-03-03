<template>
  <h1>{{ formattedRouteName }} ciao</h1>
</template>

<script lang="ts" setup>
import { useFormattedRouteName } from "../composables/useFormattedRouteName";

const { formattedRouteName } = useFormattedRouteName();
</script>
