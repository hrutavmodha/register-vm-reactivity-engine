/// <reference types="vite/client" />

declare module '*.drift' {
  import type { DriftJSComponent } from 'driftjs';
  const component: DriftJSComponent;
  export default component;
}
