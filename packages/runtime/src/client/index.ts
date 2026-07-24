import { Opcodes } from '../isa.js';
import type { Opcode, VMProgram, DriftJSComponent } from '../../types/index.js';
import { reconcileKeyedList, type ItemRecord } from './reconciler.js';
export { reconcileKeyedList, type ItemRecord };

const ALLOWED_PROPERTIES = new Set(['value', 'checked', 'disabled', 'indeterminate', 'selected', 'readOnly', 'hidden']);

function compileThunkString(thunkStr: string): Function {
  let body = thunkStr.trim();
  if (body.startsWith('(regs, vm, nodes, rootElement) =>')) {
    body = body.replace(/^\(regs,\s*vm,\s*nodes,\s*rootElement\)\s*=>\s*\{?/, '');
    if (body.endsWith('}')) {
      body = body.slice(0, -1);
    }
  } else if (body.startsWith('function')) {
    body = body.replace(/^function\s*\w*\s*\([^)]*\)\s*\{/, '').replace(/\}$/, '');
  }
  return new Function('regs', 'vm', 'nodes', 'rootElement', body);
}

/**
 * DriftJS Virtual Machine for executing bytecode programs against a target HTML element.
 */
export class DriftJSClientVM {
  private bytecode: Uint32Array;
  private constants: unknown[];
  private nodes: (Node | null)[];
  private registers: unknown[];
  private callStack: number[];
  private pc: number;
  private dirtyMask = 0;
  private updateBlockOffset = 0;
  private updatePending = false;

  private isHydrating = false;
  private hydratedNodes = new Set<Node>();
  private hydrationWalker: TreeWalker | null = null;
  
  private eventDelegationTable: Map<string, number>;
  private registeredEvents: Map<string, (e: Event) => void>;

  public readonly reconcileKeyedList = reconcileKeyedList;

  /**
   * Initializes a new VM instance.
   *
   * @param program - Compiled VM program containing bytecode and constants.
   * @param rootElement - Target HTML element to mount the application onto.
   */
  constructor(
    program: VMProgram,
    private readonly rootElement: HTMLElement
  ) {
    this.bytecode = program.bytecode;
    this.constants = program.constants;
    this.updateBlockOffset = program.updateBlockOffset ?? 0;
    this.nodes = [rootElement];
    this.registers = [null];
    this.callStack = [];
    this.pc = 0;
    this.eventDelegationTable = new Map();
    this.registeredEvents = new Map();
  }

  /**
   * Boots the application by running the initial mount block of the bytecode.
   */
  public boot(): void {
    this.pc = 0;
    this.execute();
  }

  /**
   * Hydrates an existing server-rendered HTML DOM tree without destroying or re-creating nodes.
   */
  public hydrate(): void {
    this.isHydrating = true;
    this.hydrationWalker = document.createTreeWalker(
      this.rootElement,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
    );
    this.pc = 0;
    this.execute();
    this.isHydrating = false;
    this.hydrationWalker = null;
  }

  /**
   * Unmounts the application by clearing event listeners and emptying the root element.
   */
  public unmount(): void {
    for (const [eventName, handler] of this.registeredEvents) {
      this.rootElement.removeEventListener(eventName, handler);
    }
    this.registeredEvents.clear();
    this.eventDelegationTable.clear();
    this.rootElement.innerHTML = '';
  }

  /**
   * Marks a register as dirty and schedules a reactive DOM patch update.
   *
   * @param regIdx - Register index that changed.
   */
  public markDirty(regIdx: number): void {
    this.dirtyMask |= (1 << (regIdx % 32));
    this.scheduleUpdate();
  }

  private scheduleUpdate(): void {
    if (this.updatePending) return;
    this.updatePending = true;
    queueMicrotask(() => {
      this.updatePending = false;
      this.patch();
    });
  }

  /**
   * Runs the update block to patch changed DOM elements.
   */
  public patch(): void {
    if (this.dirtyMask === 0) return;
    this.pc = this.updateBlockOffset;
    this.execute();
    this.dirtyMask = 0;
  }

  /**
   * Executes bytecode from specified program counter offset or current PC.
   *
   * @param startPc - Optional starting PC offset.
   */
  public execute(startPc?: number): void {
    if (startPc !== undefined) {
      this.pc = startPc;
    }

    while (this.pc < this.bytecode.length) {
      const instruction = this.bytecode[this.pc]!;
      this.pc++;

      const op = (instruction >> 24) & 0xFF;
      const a = (instruction >> 16) & 0xFF;
      const b = (instruction >> 8) & 0xFF;
      const c = instruction & 0xFF;
      const arg24 = instruction & 0xFFFFFF;

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
          const depMask = c;

          if (thunkIdx === 255) {
            break;
          }

          if (depMask !== 0 && (this.dirtyMask & depMask) === 0) {
            break;
          }

          let thunk = this.constants[thunkIdx];
          if (typeof thunk === 'string') {
            thunk = compileThunkString(thunk);
            this.constants[thunkIdx] = thunk;
          }

          if (typeof thunk === 'function') {
            this.registers[reg] = thunk(this.registers, this, this.nodes, this.rootElement);
          } else {
            throw new TypeError(`Execution Error: Constant at index ${thunkIdx} is not a valid thunk function.`);
          }
          break;
        }

        case Opcodes.CREATE_ELEMENT: {
          const tag = this.constants[a] as string;
          const nodeIdx = b;
          if (this.isHydrating) {
            const existing = this.findMatchingHydrationNode(1, tag);
            if (existing) {
              (existing as any).__driftNodeIdx = nodeIdx;
              this.nodes[nodeIdx] = existing;
              break;
            }
          }
          const element = document.createElement(tag);
          (element as any).__driftNodeIdx = nodeIdx;
          this.nodes[nodeIdx] = element;
          break;
        }

        case Opcodes.CREATE_TEXT: {
          const textContent = (this.constants[a] as string) ?? '';
          const nodeIdx = b;
          if (this.isHydrating) {
            const existing = this.findMatchingHydrationNode(3);
            if (existing) {
              (existing as any).__driftNodeIdx = nodeIdx;
              this.nodes[nodeIdx] = existing;
              break;
            }
          }
          const textNode = document.createTextNode(textContent);
          (textNode as any).__driftNodeIdx = nodeIdx;
          this.nodes[nodeIdx] = textNode;
          break;
        }

        case Opcodes.APPEND_CHILD: {
          const parentNode = this.nodes[a];
          const childNode = this.nodes[b];
          if (parentNode && childNode && !this.isHydrating) {
            parentNode.appendChild(childNode);
          }
          break;
        }

        case Opcodes.REMOVE_CHILD: {
          const parentNode = this.nodes[a];
          const childNode = this.nodes[b];
          if (parentNode && childNode && childNode.parentNode === parentNode) {
            parentNode.removeChild(childNode);
          }
          break;
        }

        case Opcodes.MOUNT: {
          const node = this.nodes[a];
          if (node && !this.isHydrating) {
            this.rootElement.appendChild(node);
          }
          break;
        }

        case Opcodes.SET_TEXT: {
          const nodeIdx = a;
          const regVal = String(this.registers[b] ?? '');
          const node = this.nodes[nodeIdx];
          if (node) {
            node.textContent = regVal;
          }
          break;
        }

        case Opcodes.SET_ATTRIBUTE: {
          const nodeIdx = a;
          const attrKey = this.constants[b] as string;
          const regVal = String(this.registers[c] ?? '');
          
          if (/^on/i.test(attrKey)) {
            throw new Error(`Security Violation: Cannot set inline event handler attribute "${attrKey}" via SET_ATTRIBUTE`);
          }
          if (/^(href|src|action|formaction)$/i.test(attrKey)) {
            const sanitizedVal = regVal.trim().toLowerCase();
            if (sanitizedVal.startsWith('javascript:') || sanitizedVal.startsWith('vbscript:') || sanitizedVal.startsWith('data:text/html')) {
              throw new Error(`Security Violation: Unsafe URI protocol in attribute "${attrKey}": "${regVal}"`);
            }
          }

          const node = this.nodes[nodeIdx];
          if (node && node instanceof HTMLElement) {
            node.setAttribute(attrKey, regVal);
          }
          break;
        }

        case Opcodes.SET_PROPERTY: {
          const nodeIdx = a;
          const propKey = this.constants[b] as string;
          const regVal = this.registers[c];

          if (!ALLOWED_PROPERTIES.has(propKey)) {
            throw new Error(`Security Violation: Property mutation disallowed for key "${propKey}"`);
          }

          const node = this.nodes[nodeIdx];
          if (node && node instanceof HTMLElement) {
            (node as any)[propKey] = regVal;
          }
          break;
        }

        case Opcodes.BIND_EVENT: {
          const nodeIdx = a;
          const eventName = this.constants[b] as string;
          let handlerOffset = c;

          const nextInst = this.bytecode[this.pc]!;
          if (nextInst !== undefined && ((nextInst >> 24) & 0xFF) === Opcodes.CALL) {
            handlerOffset = nextInst & 0xFFFFFF;
            this.pc++;
          }

          const targetNode = (nodeIdx === 0 ? this.rootElement : this.nodes[nodeIdx]) as HTMLElement | null;
          if (targetNode) {
            (targetNode as any).__driftNodeIdx = nodeIdx;
            targetNode.setAttribute(`data-drift-node`, String(nodeIdx));
          }

          this.eventDelegationTable.set(`${nodeIdx}:${eventName}`, handlerOffset);

          if (!this.registeredEvents.has(eventName)) {
            const delegatedListener = (e: Event) => {
              let curr: Node | null = e.target as Node | null;
              while (curr) {
                if (curr.nodeType === 1) {
                  const elem = curr as HTMLElement;
                  const privIdx = (elem as any).__driftNodeIdx;
                  const nIdxStr = privIdx !== undefined ? String(privIdx) : elem.getAttribute('data-drift-node');
                  if (nIdxStr !== null) {
                    const nIdx = parseInt(nIdxStr, 10);
                    const key = `${nIdx}:${eventName}`;
                    const offset = this.eventDelegationTable.get(key);
                    if (offset !== undefined) {
                      this.registers[0] = e;
                      this.execute(offset);
                      break;
                    }
                  }
                }
                if (curr === this.rootElement) break;
                curr = curr.parentNode;
              }
            };

            this.rootElement.addEventListener(eventName, delegatedListener);
            this.registeredEvents.set(eventName, delegatedListener);
          }
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
          const commentText = (this.constants[a] as string) ?? '';
          const nodeIdx = b;
          if (this.isHydrating) {
            const existing = this.findMatchingHydrationNode(8);
            if (existing) {
              this.nodes[nodeIdx] = existing;
              break;
            }
          }
          const commentNode = document.createComment(commentText);
          this.nodes[nodeIdx] = commentNode;
          break;
        }

        case Opcodes.INSERT_BEFORE: {
          if (this.isHydrating) break;
          const parentNode = (a === 0 ? this.rootElement : this.nodes[a]) as HTMLElement | null;
          const childNode = this.nodes[b];
          const anchorNode = this.nodes[c];
          if (parentNode && childNode && anchorNode) {
            parentNode.insertBefore(childNode, anchorNode);
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
            return; // End execution
          }
          break;
        }

        default:
          throw new Error(`Unknown opcode: ${op}`);
      }
    }
  }

  private findMatchingHydrationNode(nodeType: number, tag?: string): Node | null {
    if (!this.hydrationWalker) {
      this.hydrationWalker = document.createTreeWalker(this.rootElement, NodeFilter.SHOW_ALL);
    }
    let curr: Node | null = this.hydrationWalker.currentNode;
    while (curr) {
      if (!this.hydratedNodes.has(curr) && curr !== this.rootElement) {
        if (curr.nodeType === nodeType) {
          if (nodeType !== 1 || !tag || (curr as HTMLElement).tagName.toLowerCase() === tag.toLowerCase()) {
            this.hydratedNodes.add(curr);
            return curr;
          }
        }
      }
      curr = this.hydrationWalker.nextNode();
    }
    return null;
  }
}

/**
 * Instantiates a VM and interprets/executes a VMProgram against a target HTML element.
 *
 * @param program - Compiled VM program bytecode and constants.
 * @param target - Target HTML element to mount into.
 * @returns Active DriftJSClientVM instance.
 */
export function interpret(program: VMProgram, target: HTMLElement): DriftJSClientVM {
  const vm = new DriftJSClientVM(program, target);
  vm.boot();
  return vm;
}

/**
 * Mounts a DriftJSComponent module into a target HTML element.
 *
 * @param component - Component module object.
 * @param target - Target HTML element to mount into.
 * @returns Active DriftJSClientVM instance.
 */
export function mount(component: DriftJSComponent, target: HTMLElement): DriftJSClientVM {
  if (typeof component.render === 'function') {
    return component.render(target);
  }
  return interpret(component.program, target);
}

/**
 * Hydrates an existing server-rendered HTML DOM tree with a VMProgram.
 *
 * @param program - Compiled VM program.
 * @param target - Target HTML element containing server-rendered HTML.
 * @returns Active DriftJSClientVM instance.
 */
export function hydrate(program: VMProgram, target: HTMLElement): DriftJSClientVM {
  const vm = new DriftJSClientVM(program, target);
  vm.hydrate();
  return vm;
}
