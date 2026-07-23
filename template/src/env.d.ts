/// <reference types="vite/client" />

declare module '*.drift' {
  import type { DriftJSComponent } from '@driftjs/runtime';
  const component: DriftJSComponent;
  export default component;
}
