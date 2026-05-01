/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;
  readonly CONVEX_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __JAKESJAM_DEFAULT_ROLE__?: "host" | "player";
  __JAKESJAM_CONVEX_URL__?: string;
}
