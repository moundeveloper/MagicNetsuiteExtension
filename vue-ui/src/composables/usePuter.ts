import { ref } from "vue";
import { puter } from "@heyputer/puter.js";

// Composable to centralize Puter usage
export const usePuter = () => {
  const loading = ref(false);
  const error = ref();

  // AI chat function
  const chat = async (prompt: string) => {
    loading.value = true;
    error.value = null;

    try {
      const response = await puter.ai.chat(prompt);
      return response;
    } catch (err) {
      error.value = err;
      console.error(err);
      return null;
    } finally {
      loading.value = false;
    }
  };

  return {
    chat,
    loading,
    error
  };
};
