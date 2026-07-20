// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { driftPlugin } from '../src/index.js';
import { mountApp } from 'driftjs';

describe('vite-plugin-drift', () => {
  const plugin = driftPlugin() as any;

  it('should return null for non-.drift files', () => {
    const result = plugin.transform('const a = 1;', 'App.js');
    expect(result).toBeNull();
  });

  it('should transform .drift component code into executable JavaScript program module', () => {
    const code = '<h1>Hello Vite</h1><p>Count: {count}</p><script>let count = 0;</script>';
    const result = plugin.transform(code, 'App.drift');

    expect(result).not.toBeNull();
    expect(typeof result.code).toBe('string');
    expect(result.code).toContain('export const program');
    expect(result.code).toContain('export const mount');
    expect(result.code).toContain('updateBlockOffset:');
  });

  it('should mount transformed component onto real DOM element and resolve updates', async () => {
    const driftCode = '<p>Count: {count}</p><script>let count = 0; setTimeout(() => { count = 100; }, 15);</script>';
    const transformResult = plugin.transform(driftCode, 'App.drift');

    // Dynamically evaluate transformed plugin output code
    const cleanJsCode = transformResult.code
      .replace("import { mountApp } from 'driftjs';", "")
      .replace("export const program =", "const program =")
      .replace("export const mount = function mount(target) {", "const mount = function mount(target) {")
      .replace("export default component;", "");

    const evaluator = new Function('mountApp', 'target', `
      ${cleanJsCode}
      return mount(target);
    `);

    const root = document.createElement('div');
    evaluator(mountApp, root);

    expect(root.innerHTML).toBe('<p>Count: 0</p>');

    await new Promise(resolve => setTimeout(resolve, 40));

    expect(root.innerHTML).toBe('<p>Count: 100</p>');
  });
});
