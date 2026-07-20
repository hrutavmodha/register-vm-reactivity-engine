import type { Plugin } from 'vite';
import { parseTemplate, compile } from 'driftjs';

/**
 * Options for the DriftJS Vite plugin.
 */
export interface DriftPluginOptions {
  /**
   * Extension for single file components. Defaults to '.drift'.
   */
  extension?: string;
}

/**
 * Vite plugin for compiling .drift single-file component templates into reactive VM bytecode AOT at build time.
 *
 * @param options - Plugin configuration options.
 * @returns Vite Plugin object.
 */
export function driftPlugin(options: DriftPluginOptions = {}): Plugin {
  const extension = options.extension ?? '.drift';

  return {
    name: 'vite-plugin-drift',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!id.endsWith(extension)) {
        return null;
      }

      // 1. Parse template AST and compile bytecode program AOT at build time
      const ast = parseTemplate(code);
      const program = compile(ast);

      // 2. Serialize bytecode Uint32Array
      const bytecodeArray = Array.from(program.bytecode);

      // 3. Serialize constants (functions serialized as function expressions)
      const serializedConstants = program.constants.map(c => {
        if (typeof c === 'function') {
          return c.toString();
        }
        return JSON.stringify(c);
      });

      const jsCode = `
import { mountApp } from 'driftjs';

export const program = {
  bytecode: new Uint32Array([${bytecodeArray.join(', ')}]),
  constants: [${serializedConstants.join(', ')}],
  updateBlockOffset: ${program.updateBlockOffset ?? 0}
};

export const mount = function mount(target) {
  return mountApp(program, target);
};

const component = {
  program,
  mount
};

export default component;
`;

      return {
        code: jsCode,
        map: null
      };
    }
  };
}
