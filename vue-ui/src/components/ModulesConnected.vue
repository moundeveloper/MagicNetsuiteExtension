<template>
  <div
    class="flex items-center gap-2"
    :style="{
      color: connectionStates[connectionState].color,
    }"
    v-tooltip.bottom="{
      value:
        'If Disconnected N modules are not available on this page or role is not administrator.',
      pt: {
        arrow: {
          style: {
            borderBottomColor: 'var(--p-primary-color)',
          },
        },
        text: '!bg-primary !text-primary-contrast !font-medium',
      },
    }"
  >
    <div class="w-[24px] h-[24px] grid place-items-center">
      <svg
        v-if="connectionState === ConnectionStates.Disconnected"
        width="24"
        height="24"
        fill="none"
        :stroke="connectionStates[connectionState].color"
        stroke-width="1.5"
        viewBox="0 0 24 24"
        stroke-linecap="round"
        stroke-linejoin="round"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M5.5 13 7 11.5l5.5 5.5-1.5 1.5c-.75.75-3.5 2-5.5 0s-.75-4.75 0-5.5M3 21l2.5-2.5m13-7.5L17 12.5 11.5 7 13 5.5c.75-.75 3.5-2 5.5 0s.75 4.75 0 5.5m-6-3-2 2M21 3l-2.5 2.5m-2.5 6-2 2"
        />
      </svg>

      <svg
        v-else
        width="15"
        height="15"
        viewBox="0 0 15 15"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M3.25 11.4926C5.25 13.4926 8 12.2426 8.75 11.4926L10.25 9.99263L4.75 4.49263L3.25 5.99263C2.5 6.74263 1.25 9.49263 3.25 11.4926ZM3.25 11.4926L0.75 13.9926M11.4926 3.25C13.4926 5.25 12.2426 8 11.4926 8.75L9.99265 10.25L4.49265 4.75L5.99265 3.25C6.74265 2.5 9.49265 1.25 11.4926 3.25ZM11.4926 3.25L13.9926 0.75"
          :stroke="connectionStates[connectionState].color"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    - {{ connectionStates[connectionState].text }}
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";

enum ConnectionStates {
  Disconnected = "disconnected",
  Connected = "connected",
}

const connectionState = ref<ConnectionStates>(ConnectionStates.Connected);

const connectionStates = {
  [ConnectionStates.Disconnected]: {
    text: "Disconnected",
    color: "red",
  },
  [ConnectionStates.Connected]: {
    text: "Connected",
    color: "green",
  },
};

const checkConnection = () => {
  setInterval(async () => {
    try {
      const response = await callApi(RequestRoutes.CHECK_CONNECTION);
      if (!response) return;
      const { message: connectionStatus } = response as ApiResponse;

      connectionState.value =
        connectionStatus === ConnectionStates.Connected
          ? ConnectionStates.Connected
          : ConnectionStates.Disconnected;
    } catch (error) {
      console.log("Error", error);
      connectionState.value = ConnectionStates.Disconnected;
    }
  }, 2000);
};

onMounted(() => {
  checkConnection();
});
</script>

<style scoped></style>
