import type { Opcodes } from '../src/isa.js';

export type Opcode = typeof Opcodes[keyof typeof Opcodes];

export interface VMProgram {
  bytecode: Uint32Array;
  constants: unknown[];
  updateBlockOffset?: number;
}

export interface DriftJSComponent {
  program: VMProgram;
  ast?: unknown[];
  render?: (target: HTMLElement) => any;
}
