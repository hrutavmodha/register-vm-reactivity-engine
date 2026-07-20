// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { DriftJSVM, mountApp } from '../src/vm/index.js';
import { parseTemplate } from '../src/parser/index.js';
import { compile } from '../src/compiler/index.js';

describe('DriftJSVM', () => {
  describe('constructor input data passing', () => {
    it('should mount app when program and root element are passed in constructor', () => {
      const ast = parseTemplate('<div>Hello VM</div>');
      const program = compile(ast);
      const root = document.createElement('div');

      const vm = new DriftJSVM(program, root);
      vm.mount();

      expect(root.innerHTML).toBe('<div>Hello VM</div>');
      vm.unmount();
    });

    it('should mount app via mountApp convenience function', () => {
      const ast = parseTemplate('<p>App VM</p>');
      const program = compile(ast);
      const root = document.createElement('div');

      const vm = mountApp(program, root);

      expect(root.innerHTML).toBe('<p>App VM</p>');
      vm.unmount();
    });
  });

  describe('fine-grained async reactivity', () => {
    it('should update DOM asynchronously when state is mutated inside setTimeout', async () => {
      const template = '<p>Count: {count}</p><script>let count = 0; setTimeout(() => { count = 42; }, 10);</script>';
      const ast = parseTemplate(template);
      const program = compile(ast);
      const root = document.createElement('div');

      const vm = mountApp(program, root);
      expect(root.innerHTML).toBe('<p>Count: 0</p>');

      await new Promise(resolve => setTimeout(resolve, 30));

      expect(root.innerHTML).toBe('<p>Count: 42</p>');
      vm.unmount();
    });

    it('should batch multiple synchronous mutations into a single microtask DOM update', async () => {
      const template = '<p>Count: {count}</p><script>let count = 0; setTimeout(() => { count = 1; count = 2; count = 3; }, 10);</script>';
      const ast = parseTemplate(template);
      const program = compile(ast);
      const root = document.createElement('div');

      const vm = mountApp(program, root);
      expect(root.innerHTML).toBe('<p>Count: 0</p>');

      await new Promise(resolve => setTimeout(resolve, 30));

      expect(root.innerHTML).toBe('<p>Count: 3</p>');
      vm.unmount();
    });

    it('should retain O(1) bitmask dependency check so unchanged signals are skipped during re-render', async () => {
      const template = '<p>A: {a}</p><p>B: {b}</p><script>let a = 1; let b = 10; setTimeout(() => { a = 2; }, 10);</script>';
      const ast = parseTemplate(template);
      const program = compile(ast);
      const root = document.createElement('div');

      const vm = mountApp(program, root);
      expect(root.innerHTML).toBe('<p>A: 1</p><p>B: 10</p>');

      await new Promise(resolve => setTimeout(resolve, 30));

      expect(root.innerHTML).toBe('<p>A: 2</p><p>B: 10</p>');
      vm.unmount();
    });

    it('should update DOM asynchronously when state is mutated inside Promise.then', async () => {
      const template = '<p>Status: {status}</p><script>let status = "loading"; Promise.resolve("done").then(val => { status = val; });</script>';
      const ast = parseTemplate(template);
      const program = compile(ast);
      const root = document.createElement('div');

      const vm = mountApp(program, root);
      expect(root.innerHTML).toBe('<p>Status: loading</p>');

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(root.innerHTML).toBe('<p>Status: done</p>');
      vm.unmount();
    });

    it('should update DOM when state is mutated inside async function with await', async () => {
      const template = '<p>Data: {data}</p><script>let data = "none"; async function loadData() { const res = await Promise.resolve("loaded"); data = res; } loadData();</script>';
      const ast = parseTemplate(template);
      const program = compile(ast);
      const root = document.createElement('div');

      const vm = mountApp(program, root);
      expect(root.innerHTML).toBe('<p>Data: none</p>');

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(root.innerHTML).toBe('<p>Data: loaded</p>');
      vm.unmount();
    });

    it('should update DOM repeatedly on setInterval ticks', async () => {
      const template = '<p>Ticks: {ticks}</p><script>let ticks = 0; const timer = setInterval(() => { ticks++; if (ticks >= 3) clearInterval(timer); }, 15);</script>';
      const ast = parseTemplate(template);
      const program = compile(ast);
      const root = document.createElement('div');

      const vm = mountApp(program, root);
      expect(root.innerHTML).toBe('<p>Ticks: 0</p>');

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(root.innerHTML).toBe('<p>Ticks: 3</p>');
      vm.unmount();
    });

    it('should update DOM asynchronously when state is mutated after fetch() resolves', async () => {
      const originalFetch = globalThis.fetch;
      (globalThis as any).fetch = async () => ({
        json: async () => ({ user: 'Alice' })
      });

      try {
        const template = '<p>User: {username}</p><script>let username = "Guest"; async function fetchUser() { const res = await fetch("/api/user"); const data = await res.json(); username = data.user; } fetchUser();</script>';
        const ast = parseTemplate(template);
        const program = compile(ast);
        const root = document.createElement('div');

        const vm = mountApp(program, root);
        expect(root.innerHTML).toBe('<p>User: Guest</p>');

        await new Promise(resolve => setTimeout(resolve, 30));

        expect(root.innerHTML).toBe('<p>User: Alice</p>');
        vm.unmount();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
