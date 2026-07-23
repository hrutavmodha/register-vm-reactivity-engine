import { Opcodes } from '../isa.js';
import { VOID_ELEMENTS } from '../constants.js';
import type { Opcode, VMProgram, DriftJSComponent } from '../../types/index.js';

export interface VirtualElementNode {
  type: 'Element';
  tag: string;
  attributes: Map<string, string>;
  children: (VirtualElementNode | VirtualTextNode)[];
}

export interface VirtualTextNode {
  type: 'Text';
  content: string;
}

export type VirtualNode = VirtualElementNode | VirtualTextNode;

/**
 * Headless Server-Side VM for executing DriftJS bytecode and rendering HTML strings.
 */
export class DriftJSServerVM {
  private bytecode: Uint32Array;
  private constants: unknown[];
  private nodes: (VirtualNode | null)[];
  private registers: unknown[];
  private callStack: number[];
  private pc = 0;
  private rootChildren: VirtualNode[] = [];

  constructor(program: VMProgram) {
    this.bytecode = program.bytecode;
    this.constants = program.constants;
    this.nodes = [];
    this.registers = [null];
    this.callStack = [];
    this.pc = 0;
  }

  /**
   * Dummy markDirty for server environment compatibility during script thunk execution.
   */
  public markDirty(_regIdx: number): void {
    // No-op during SSR rendering pass
  }

  /**
   * Runs the initial mount block of the bytecode program to build the virtual DOM tree.
   */
  public execute(): void {
    this.pc = 0;
    this.rootChildren = [];

    while (this.pc < this.bytecode.length) {
      const inst = this.bytecode[this.pc]!;
      const op = ((inst >> 24) & 0xFF) as Opcode;
      const a = (inst >> 16) & 0xFF;
      const b = (inst >> 8) & 0xFF;
      const c = inst & 0xFF;
      const arg24 = inst & 0xFFFFFF;

      this.pc++;

      switch (op) {
        case Opcodes.LOAD_CONST: {
          this.registers[a] = this.constants[b];
          break;
        }

        case Opcodes.LOAD_NODE: {
          this.registers[a] = this.nodes[b] ?? null;
          break;
        }

        case Opcodes.EXEC_THUNK: {
          const reg = a;
          const thunkIdx = b;
          let thunk = this.constants[thunkIdx];
          if (typeof thunk === 'string' && (thunk.startsWith('(regs, vm') || thunk.startsWith('function'))) {
            thunk = (0, eval)(thunk.startsWith('function') ? `(${thunk})` : thunk);
            this.constants[thunkIdx] = thunk;
          }
          if (typeof thunk === 'function') {
            this.registers[reg] = thunk(this.registers, this, this.nodes, (this as any).rootElement || (this as any).root);
          }
          break;
        }

        case Opcodes.CREATE_ELEMENT: {
          const tag = (this.constants[a] as string) ?? 'div';
          const nodeIdx = b;
          const vNode: VirtualElementNode = {
            type: 'Element',
            tag,
            attributes: new Map(),
            children: []
          };
          this.nodes[nodeIdx] = vNode;
          break;
        }

        case Opcodes.CREATE_TEXT: {
          const content = String(this.constants[a] ?? '');
          const nodeIdx = b;
          const textNode: VirtualTextNode = {
            type: 'Text',
            content
          };
          this.nodes[nodeIdx] = textNode;
          break;
        }

        case Opcodes.APPEND_CHILD: {
          const parentIdx = a;
          const childIdx = b;
          const child = this.nodes[childIdx];
          if (!child) break;

          if (parentIdx === 0) {
            this.rootChildren.push(child);
          } else {
            const parent = this.nodes[parentIdx];
            if (parent && parent.type === 'Element') {
              parent.children.push(child);
            }
          }
          break;
        }

        case Opcodes.MOUNT: {
          const nodeIdx = a;
          const targetNode = this.nodes[nodeIdx];
          if (targetNode) {
            this.rootChildren.push(targetNode);
          }
          break;
        }

        case Opcodes.SET_TEXT: {
          const nodeIdx = a;
          const regVal = String(this.registers[b] ?? '');
          const node = this.nodes[nodeIdx];
          if (node) {
            if (node.type === 'Text') {
              node.content = regVal;
            } else if (node.type === 'Element') {
              node.children = [{ type: 'Text', content: regVal }];
            }
          }
          break;
        }

        case Opcodes.SET_ATTRIBUTE:
        case Opcodes.SET_PROPERTY: {
          const nodeIdx = a;
          const attrKey = this.constants[b] as string;
          const regVal = String(this.registers[c] ?? '');
          const node = this.nodes[nodeIdx];
          if (node && node.type === 'Element') {
            node.attributes.set(attrKey, regVal);
          }
          break;
        }

        case Opcodes.BIND_EVENT: {
          // Ignore event bindings during server-side static rendering
          break;
        }

        case Opcodes.JUMP: {
          this.pc = arg24;
          break;
        }

        case Opcodes.JUMP_IF_TRUE: {
          const condReg = a;
          if (Boolean(this.registers[condReg])) {
            this.pc = (b << 8) | c;
          }
          break;
        }

        case Opcodes.JUMP_IF_FALSE: {
          const condReg = a;
          if (!Boolean(this.registers[condReg])) {
            this.pc = (b << 8) | c;
          }
          break;
        }

        case Opcodes.JUMP_IF_EQUAL: {
          const regA = a;
          const regB = b;
          const targetPc = c;
          if (this.registers[regA] === this.registers[regB]) {
            this.pc = targetPc;
          }
          break;
        }

        case Opcodes.CREATE_COMMENT: {
          break;
        }

        case Opcodes.INSERT_BEFORE: {
          const parentIdx = a;
          const childIdx = b;
          const child = this.nodes[childIdx];
          if (!child) break;

          if (parentIdx === 0) {
            this.rootChildren.push(child);
          } else {
            const parent = this.nodes[parentIdx];
            if (parent && parent.type === 'Element') {
              parent.children.push(child);
            }
          }
          break;
        }

        case Opcodes.CALL: {
          this.callStack.push(this.pc);
          this.pc = arg24;
          break;
        }

        case Opcodes.RETURN: {
          if (this.callStack.length > 0) {
            this.pc = this.callStack.pop()!;
          } else {
            return; // End execution of mount sequence
          }
          break;
        }

        default:
          break;
      }
    }
  }

  /**
   * Renders the executed virtual DOM tree into an HTML string.
   */
  public renderToString(): string {
    this.execute();
    return this.rootChildren.map(node => serializeVirtualNode(node)).join('');
  }
}

function serializeVirtualNode(node: VirtualNode): string {
  if (node.type === 'Text') {
    return escapeHtml(node.content);
  }

  const tag = node.tag.toLowerCase();
  let attrStr = '';
  for (const [key, value] of node.attributes.entries()) {
    attrStr += ` ${escapeHtml(key)}="${escapeHtml(value)}"`;
  }

  if (VOID_ELEMENTS.has(tag)) {
    return `<${tag}${attrStr}>`;
  }

  const childrenHtml = node.children.map(child => serializeVirtualNode(child)).join('');
  return `<${tag}${attrStr}>${childrenHtml}</${tag}>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Server-Side Renders a VMProgram into an HTML string.
 *
 * @param program - Compiled VM program.
 * @returns Serialized HTML string.
 */
export function renderToString(program: VMProgram): string {
  const vm = new DriftJSServerVM(program);
  return vm.renderToString();
}

