/// <reference types="vite/client" />
import type { KongyoApi } from "@shared/api";

declare global {
  interface Window {
    api: KongyoApi;
  }

  const __APP_VERSION__: string;
}

export {};
