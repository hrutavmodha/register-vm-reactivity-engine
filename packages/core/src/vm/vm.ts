import { Opcodes, type Opcode } from './isa.js';

export interface VMProgram {
  bytecode: Uint32Array;
  constants: any[];
  updateBlockOffset?: number;
}

/**
 * DriftJS Virtual Machine for executing bytecode programs against a target HTML element.
 */
export class DriftJSVM {
  private bytecode: Uint32Array;
  private constants: any[];
  private nodes: (Node | null)[];
  private registers: any[];
  private callStack: number[];
  private pc: number;
  private dirtyMask: number = ~0; // ~0 means all registers dirty initially
  private prevRegBuffer: any[];
  private updateBlockOffset: number = 0;
  private updatePending: boolean = false;
  
  private eventDelegationTable: Map<string, number>;
  private registeredEvents: Map<string, (e: Event) => void>;

  /**
   * Initializes a new VM instance.
   *
   * @param program - Compiled VM program containing bytecode and constants.
   * @param rootElement - Target HTML element to mount the application into.
   */
  constructor(
    private program: VMProgram,
    private rootElement: HTMLElement
  ) {
    this.bytecode = this.program.bytecode;
    this.constants = this.program.constants;
    this.updateBlockOffset = this.program.updateBlockOffset ?? 0;
    this.nodes = [];
    const maxRegs = Math.max(256, this.computeMaxRegisterCount(this.bytecode));
    this.registers = new Array(maxRegs).fill(null);
    this.prevRegBuffer = new Array(maxRegs).fill(null);
    this.callStack = [];
    this.pc = 0;
    this.eventDelegationTable = new Map();
    this.registeredEvents = new Map();
  }

  private computeMaxRegisterCount(bytecode: Uint32Array): number {
    let maxReg = 0;
    for (let i = 0; i < bytecode.length; i++) {
      const inst = bytecode[i]!;
      const a = (inst >>> 16) & 0xFF;
      const b = (inst >>> 8) & 0xFF;
      const c = inst & 0xFF;
      if (a > maxReg) maxReg = a;
      if (b > maxReg) maxReg = b;
      if (c > maxReg) maxReg = c;
    }
    return maxReg + 1;
  }

  private registerGlobalEvent(eventType: string) {
    if (this.registeredEvents.has(eventType)) {
      return;
    }
    
    const listener = (event: Event) => {
      let target = event.target as Node | null;
      
      while (target && target !== this.rootElement) {
        const nodeIdx = (target as any).__vm_idx;

        if (nodeIdx !== undefined && nodeIdx !== -1) {
          const key = `${nodeIdx}:${eventType}`;
          const offset = this.eventDelegationTable.get(key);
        
          if (offset !== undefined) {
            this.registers[0] = event;
            this.dispatchEvent(offset);
            return;
          }
        }
        
        target = target.parentNode;
      }
    };

    this.registeredEvents.set(eventType, listener);
    this.rootElement.addEventListener(eventType, listener);
  }

  /**
   * Marks a register as dirty and schedules a microtask UI update frame.
   *
   * @param regIdx - Index of the register that was mutated.
   */
  public markDirty(regIdx: number): void {
    if (this.dirtyMask === ~0) {
      this.dirtyMask = 0;
    }
    this.dirtyMask |= (1 << (regIdx % 32));
    this.requestUpdate();
  }

  /**
   * Schedules a microtask DOM update frame if an update is not already pending.
   */
  public requestUpdate(): void {
    if (this.dirtyMask === 0) {
      this.dirtyMask = ~0;
    }
    if (this.updatePending) return;
    this.updatePending = true;
    queueMicrotask(() => {
      this.updatePending = false;
      this.dispatchEvent(this.updateBlockOffset);
    });
  }

  /**
   * Mounts the program and executes the initial instructions.
   */
  public mount(): void {
    this.dirtyMask = ~0;
    this.pc = 0;
    this.execute();
  }

  /**
   * Unmounts the application, removes listeners, and frees all references for GC.
   */
  public unmount() {
    for (const [eventType, listener] of this.registeredEvents.entries()) {
      this.rootElement.removeEventListener(eventType, listener);
    }
    this.registeredEvents.clear();
    this.eventDelegationTable.clear();
    this.nodes.fill(null);
    this.registers.fill(null);
    this.prevRegBuffer.fill(null);
    this.callStack.length = 0;
    this.rootElement.innerHTML = '';
  }

  /**
   * Jumps to a specific bytecode offset, typically used for event handlers.
   */
  public dispatchEvent(offset: number) {
    this.pc = offset;
    this.execute();
  }

  private execute() {
    const bytecode = this.bytecode;
    const constants = this.constants;
    const nodes = this.nodes;
    const registers = this.registers;
    const callStack = this.callStack;
    const prevRegBuffer = this.prevRegBuffer;

    while (this.pc < bytecode.length) {
      const inst = bytecode[this.pc++]!;
      
      const op = (inst >>> 24) & 0xFF as Opcode;
      const a = (inst >>> 16) & 0xFF;
      const b = (inst >>> 8) & 0xFF;
      const c = inst & 0xFF;

      switch (op) {
        case Opcodes.LOAD_CONST:
          registers[a] = constants[b];
          break;
        case Opcodes.LOAD_NODE:
          registers[a] = nodes[b];
          break;

        case Opcodes.EXEC_THUNK: {
          const destReg = a;
          const thunkIdx = b;
          const depMask = c;

          if (depMask !== 0 && this.dirtyMask !== ~0 && (this.dirtyMask & depMask) === 0) {
            this.pc++;
            break;
          }

          const limit = Math.min(registers.length, 32);
          for (let i = 0; i < limit; i++) {
            prevRegBuffer[i] = registers[i];
          }

          const res = constants[thunkIdx](registers, this);
          if (destReg !== 0) {
            registers[destReg] = res;
          } else {
            let mask = 0;
            for (let i = 0; i < limit; i++) {
              if (registers[i] !== prevRegBuffer[i]) {
                mask |= (1 << i);
              }
            }
            if (mask !== 0) {
              this.dirtyMask = mask;
            }
          }
          break;
        }

        case Opcodes.CREATE_ELEMENT: {
          const tag = constants[a] as string;
          const el = document.createElement(tag);
          nodes[b] = el;
          (el as any).__vm_idx = b; 
          break;
        }
        case Opcodes.CREATE_TEXT: {
          const text = constants[a] as string;
          nodes[b] = document.createTextNode(text);
          break;
        }
        case Opcodes.APPEND_CHILD: {
          const parent = nodes[a] as Node;
          const child = nodes[b] as Node;
          parent.appendChild(child);
          break;
        }
        case Opcodes.REMOVE_CHILD: {
          const parent = nodes[a] as Node;
          const child = nodes[b] as Node;
          if (parent && child && child.parentNode === parent) {
            parent.removeChild(child);
          }
          break;
        }
        case Opcodes.MOUNT: {
          const child = nodes[a] as Node;
          this.rootElement.appendChild(child);
          break;
        }

        case Opcodes.SET_TEXT: {
          const node = nodes[a] as Node;
          const val = registers[b] == null ? '' : String(registers[b]);
          if (node.nodeValue !== val) {
            node.nodeValue = val;
          }
          break;
        }
        case Opcodes.SET_ATTRIBUTE: {
          const node = nodes[a] as Element;
          const attr = constants[b] as string;
          const val = registers[c] == null ? '' : String(registers[c]);
          if (node.getAttribute(attr) !== val) {
            node.setAttribute(attr, val);
          }
          break;
        }
        case Opcodes.SET_PROPERTY: {
          const node = nodes[a] as any;
          const prop = constants[b] as string;
          const val = registers[c];
          if (node && node[prop] !== val) {
            node[prop] = val;
          }
          break;
        }

        case Opcodes.BIND_EVENT: {
          const nodeIdx = a;
          const eventType = constants[b] as string;
          const jumpOffset = c;

          const key = `${nodeIdx}:${eventType}`;
          this.eventDelegationTable.set(key, jumpOffset);
          
          this.registerGlobalEvent(eventType);
          break;
        }

        case Opcodes.JUMP: {
          const offset = inst & 0xFFFFFF;
          this.pc = offset;
          break;
        }

        case Opcodes.RETURN: {
          registers[0] = null; // Free event object reference for GC
          this.dirtyMask = 0;  // Reset for next execution
          if (callStack.length > 0) {
            this.pc = callStack.pop()!;
            break;
          }
          return;
        }

        default:
          throw new Error(`Unknown opcode: ${op}`);
      }
    }
  }
}

export interface DriftJSComponent {
  program: VMProgram;
  ast?: any[];
  mount?: (target: HTMLElement) => DriftJSVM;
}

export type DriftComponent = DriftJSComponent;

/**
 * Convenience function to create and mount a DriftJSVM instance.
 *
 * @param program - The compiled VM program to execute.
 * @param rootElement - Target HTML element to mount into.
 * @returns Mounted DriftJSVM instance.
 */
export function mountApp(program: VMProgram, rootElement: HTMLElement): DriftJSVM {
  const vm = new DriftJSVM(program, rootElement);
  vm.mount();
  return vm;
}

/**
 * Mounts a DriftComponent into a target HTML element.
 *
 * @param component - The component containing compiled program bytecode.
 * @param target - Target HTML element to mount into.
 * @returns Mounted DriftJSVM instance.
 */
export function mount(component: DriftComponent, target: HTMLElement): DriftJSVM {
  if (typeof component.mount === 'function') {
    return component.mount(target);
  }
  return mountApp(component.program, target);
}
