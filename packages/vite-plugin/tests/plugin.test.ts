// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { driftPlugin } from '../src/index.js';
import { interpret } from '@driftjs/runtime';

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
    expect(result.code).toContain('function _thunk0(');
    expect(result.code).toContain('export const program');
    expect(result.code).toContain('export const render');
    expect(result.code).toContain('updateBlockOffset:');
  });

  it('should mount transformed component onto real DOM element and resolve updates', async () => {
    const driftCode = '<p>Count: {count}</p><script>let count = 0; setTimeout(() => { count = 100; }, 15);</script>';
    const transformResult = plugin.transform(driftCode, 'App.drift');

    // Dynamically evaluate transformed plugin output code
    const cleanJsCode = transformResult.code
      .replace("import { interpret } from '@driftjs/runtime';", "")
      .replace("export const program =", "const program =")
      .replace("export const render = function render(target) {", "const render = function render(target) {")
      .replace("export default component;", "");

    const evaluator = (interpretFn: typeof interpret, targetEl: HTMLElement) => {
      const fn = (0, eval)(`((interpret, target) => {
        ${cleanJsCode}
        return render(target);
      })`);
      return fn(interpretFn, targetEl);
    };

    const root = document.createElement('div');
    evaluator(interpret, root);

    expect(root.innerHTML).toBe('<p>Count: 0</p>');

    await new Promise(resolve => setTimeout(resolve, 40));

    expect(root.innerHTML).toBe('<p>Count: 100</p>');
  });

  it('should propagate build-time template compilation error on undeclared state variable', () => {
    const code = '<p>{count}</p>';
    expect(() => plugin.transform(code, 'App.drift')).toThrow('Variable "count" is not defined in state');
  });
});
