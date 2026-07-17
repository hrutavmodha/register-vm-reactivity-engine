import { Opcodes, type Opcode } from './isa.js';

export interface VMProgram {
  bytecode: Uint32Array;
  constants: any[];
}

type EventHandlerMap = Map<string, number>;

export class ReactivityVM {
  private bytecode: Uint32Array;
  private constants: any[];
  private nodes: (Node | null)[];
  private registers: any[];
  private callStack: number[];
  private pc: number;
  
  private eventDelegationTable: Map<number, EventHandlerMap>;
  private registeredEvents: Set<string>;

  constructor(program: VMProgram, private rootElement: HTMLElement) {
    this.bytecode = program.bytecode;
    this.constants = program.constants;
    this.nodes = [];
    this.registers = new Array(256).fill(null);
    this.callStack = [];
    this.pc = 0;
    this.eventDelegationTable = new Map();
    this.registeredEvents = new Set();
  }

  private registerGlobalEvent(eventType: string) {
    if (this.registeredEvents.has(eventType)) {
      return;
    }
    
    this.registeredEvents.add(eventType);
    
    this.rootElement.addEventListener(eventType, (event) => {
      let target = event.target as Node | null;
      
      while (target && target !== this.rootElement) {
        const nodeIdx = (target as any).__vm_idx;

        if (nodeIdx !== undefined && nodeIdx !== -1) {
          const handlers = this.eventDelegationTable.get(nodeIdx);
        
          if (handlers && handlers.has(eventType)) {
            const offset = handlers.get(eventType)!;
            this.registers[0] = event;
            this.dispatchEvent(offset);
            return;
          }
        }
        
        target = target.parentNode;
      }
    });
  }

  /**
   * Mounts the program and executes the initial instructions.
   */
  public mount() {
    this.pc = 0;
    this.execute();
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

        case Opcodes.EXEC_THUNK:
          registers[a] = constants[b](registers);
          break;

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
        case Opcodes.MOUNT: {
          const child = nodes[a] as Node;
          this.rootElement.appendChild(child);
          break;
        }

        case Opcodes.SET_TEXT: {
          const node = nodes[a] as Node;
          node.textContent = registers[b];
          break;
        }
        case Opcodes.SET_ATTRIBUTE: {
          const node = nodes[a] as Element;
          const attr = constants[b] as string;
          node.setAttribute(attr, registers[c]);
          break;
        }

        case Opcodes.BIND_EVENT: {
          const nodeIdx = a;
          const eventType = constants[b] as string;
          const jumpOffset = c;

          let handlers = this.eventDelegationTable.get(nodeIdx);
          if (!handlers) {
            handlers = new Map();
            this.eventDelegationTable.set(nodeIdx, handlers);
          }
          handlers.set(eventType, jumpOffset);
          
          this.registerGlobalEvent(eventType);
          break;
        }

        case Opcodes.JUMP: {
          const offset = inst & 0xFFFFFF;
          this.pc = offset;
          break;
        }
        case Opcodes.JUMP_IF: {
          const regCond = a;
          const offset = inst & 0xFFFF;
          if (registers[regCond]) {
            this.pc = offset;
          }
          break;
        }

        case Opcodes.CALL: {
          const offset = inst & 0xFFFFFF;
          this.callStack.push(this.pc);
          this.pc = offset;
          break;
        }

        case Opcodes.RETURN: {
          if (this.callStack.length > 0) {
            this.pc = this.callStack.pop()!;
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
