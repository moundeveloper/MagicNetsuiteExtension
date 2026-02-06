// composables/useFormattedRouteName.ts
import { computed } from "vue";
import { useRoute } from "vue-router";

export function useFormattedRouteName() {
  const route = useRoute();

  const formattedRouteName = computed(() => {
    const routeName = route.name as string | undefined;
    if (!routeName) return "";

    return `//${routeName.replace(/\s+/g, "-").toUpperCase()}`;
  });

  return {
    formattedRouteName
  };
}
