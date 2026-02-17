import { createApp } from "vue";
import "./style.css";
import "primeicons/primeicons.css";
import "virtual:uno.css";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

import App from "./App.vue";
import PrimeVue from "primevue/config";
import Aura from "@primeuix/themes/aura";
import { definePreset } from "@primeuix/themes";
import { router } from "./router";
import { basicSetup } from "codemirror";
import VueCodemirror from "vue-codemirror";
import { createPinia } from "pinia";
import Tooltip from "primevue/tooltip";
import ToastService from "primevue/toastservice";

const auraPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: "{slate.50}",
      100: "{slate.100}",
      200: "{slate.200}",
      300: "{slate.300}",
      400: "{slate.400}",
      500: "{slate.500}",
      600: "{slate.600}",
      700: "{slate.700}",
      800: "{slate.800}",
      900: "{slate.900}",
      950: "{slate.950}",
    },
    colorScheme: {
      light: {
        surface: {
          0: "{slate.100}",
          50: "{zinc.50}",
          100: "{zinc.100}",
          200: "{zinc.200}",
          300: "{zinc.300}",
          400: "{zinc.400}",
          500: "{zinc.500}",
          600: "{zinc.600}",
          700: "{zinc.700}",
          800: "{zinc.800}",
          900: "{zinc.900}",
          950: "{zinc.950}",
        },
      },
      dark: {
        surface: {
          0: "#ffffff",
          50: "{slate.50}",
          100: "{slate.100}",
          200: "{slate.200}",
          300: "{slate.300}",
          400: "{slate.400}",
          500: "{slate.500}",
          600: "{slate.600}",
          700: "{slate.700}",
          800: "{slate.800}",
          900: "{slate.900}",
          950: "{slate.950}",
        },
      },
    },
  },
});

const app = createApp(App);

app.use(router);

const initialRoute = window.location.hash.slice(1);
if (initialRoute) {
  router.push(initialRoute);
}

app.use(PrimeVue, {
  theme: {
    preset: auraPreset,
    options: {
      prefix: "p",
      darkModeSelector: "light",
    },
  },
});

app.use(ToastService);

app.use(createPinia());

app.directive("tooltip", Tooltip);

app.use(VueCodemirror, {
  // optional default global options
  autofocus: true,
  disabled: false,
  indentWithTab: true,
  tabSize: 2,
  placeholder: "Code goes here...",
  extensions: [basicSetup],
});

app.mount("#app");
