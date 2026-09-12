/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALLOW_REMOTE_MODEL_ASSETS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
