import { Opcodes, encodeInstruction } from '@register-vm-reactivity-engine/vm';
import type { ASTNode } from '@register-vm-reactivity-engine/parser';
import * as acorn from 'acorn';
import { walk } from 'estree-walker';

export interface CompiledProgram {
  bytecode: Uint32Array;
  constants: any[];
}

export class Compiler {
  private bytecode: number[] = [];
  private constants: any[] = [];
  private nextNodeIdx = 0;
  private nextRegIdx = 1;
  private varToReg: Map<string, number> = new Map();

  private updates: { nodeIdx: number, reg: number, thunkIdx: number }[] = [];
  private eventHandlers: { nodeIdx: number, eventIdx: number, handlerStr: string, bindInstIdx: number }[] = [];

  private getRegForVar(name: string): number {
    return this.varToReg.get(name)!;
  }

  private rewriteExpression(expr: string): string {
    const jsAst = acorn.parse(expr, { ecmaVersion: 2020, allowReturnOutsideFunction: true });
    const replacements: { start: number, end: number, text: string }[] = [];

    walk(jsAst as any, {
      enter: (node: any, parent: any) => {
        if (node.type === 'Identifier') {
          if (parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
          if (parent && parent.type === 'Property' && parent.key === node && !parent.computed) return;
          
          // Strict Validation
          if (!this.varToReg.has(node.name)) {
            throw new Error(`Variable "${node.name}" is not defined in state`);
          }

          const reg = this.getRegForVar(node.name);
          replacements.push({ start: node.start, end: node.end, text: `regs[${reg}]` });
        }
      }
    });

    replacements.sort((a, b) => b.start - a.start);
    let rewritten = expr;
    for (const rep of replacements) {
      rewritten = rewritten.slice(0, rep.start) + rep.text + rewritten.slice(rep.end);
    }
    return rewritten;
  }

  private compileScript(scriptNode: any): number {
    const jsAst = acorn.parse(scriptNode.content, { ecmaVersion: 2020 });
    
    // First pass: Discover all state variables
    walk(jsAst as any, {
      enter: (node: any) => {
        if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
          this.varToReg.set(node.id.name, this.nextRegIdx++);
        }
      }
    });

    // Second pass: Rewrite declarations to assignments (e.g. let count = 0 -> regs[X] = 0)
    const replacements: { start: number, end: number, text: string }[] = [];
    walk(jsAst as any, {
      enter: (node: any, parent: any) => {
        if (node.type === 'VariableDeclaration') {
          // Replace "let " or "const " with spaces
          replacements.push({ start: node.start, end: node.declarations[0].start, text: ' '.repeat(node.declarations[0].start - node.start) });
        }
        if (node.type === 'Identifier') {
          if (parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
          if (parent && parent.type === 'Property' && parent.key === node && !parent.computed) return;
          
          if (this.varToReg.has(node.name)) {
            const reg = this.getRegForVar(node.name);
            replacements.push({ start: node.start, end: node.end, text: `regs[${reg}]` });
          }
        }
      }
    });

    replacements.sort((a, b) => b.start - a.start);
    let rewritten = scriptNode.content;
    for (const rep of replacements) {
      rewritten = rewritten.slice(0, rep.start) + rep.text + rewritten.slice(rep.end);
    }

    const thunk = new Function('regs', rewritten);
    return this.getConstant(thunk);
  }

  public compile(ast: ASTNode[]): CompiledProgram {
    const scriptNodes = ast.filter(n => n.type === 'Script');
    
    // First, compile scripts to populate varToReg
    const scriptThunkIndices: number[] = [];
    for (const script of scriptNodes) {
      scriptThunkIndices.push(this.compileScript(script));
    }

    const rootNodes = ast.filter(n => n.type !== 'Script').map(node => this.compileNode(node));

    // Emit script thunks at the beginning
    for (const thunkIdx of scriptThunkIndices) {
      this.emit(Opcodes.EXEC_THUNK, 0, thunkIdx);
    }

    for (const rootIdx of rootNodes) {
      this.emit(Opcodes.MOUNT, rootIdx);
    }
    
    const endOfMountJumpIdx = this.bytecode.length;
    this.emit24(Opcodes.JUMP, 0); 

    const updateBlockOffset = this.bytecode.length;
    for (const up of this.updates) {
      this.emit(Opcodes.EXEC_THUNK, up.reg, up.thunkIdx);
      this.emit(Opcodes.SET_TEXT, up.nodeIdx, up.reg);
    }
    this.emit(Opcodes.RETURN); 

    for (const handler of this.eventHandlers) {
      const handlerOffset = this.bytecode.length;
      this.bytecode[handler.bindInstIdx] = encodeInstruction(Opcodes.BIND_EVENT, handler.nodeIdx, handler.eventIdx, handlerOffset);

      const rewritten = this.rewriteExpression(handler.handlerStr);
      const thunk = new Function('regs', rewritten);
      const thunkIdx = this.getConstant(thunk);
      
      this.emit(Opcodes.EXEC_THUNK, 0, thunkIdx);
      this.emit24(Opcodes.JUMP, updateBlockOffset); 
    }

    const endOfProgramOffset = this.bytecode.length;
    this.bytecode[endOfMountJumpIdx] = this.encodeInstruction24(Opcodes.JUMP, updateBlockOffset);

    return {
      bytecode: new Uint32Array(this.bytecode),
      constants: this.constants,
    };
  }

  private compileNode(node: ASTNode): number {
    switch (node.type) {
      case 'Element': return this.compileElement(node);
      case 'Text': return this.compileText(node);
      case 'Interpolation': return this.compileInterpolation(node);
      default: throw new Error(`Unknown node type`);
    }
  }

  private compileElement(node: any): number {
    const nodeIdx = this.nextNodeIdx++;
    const tagIdx = this.getConstant(node.tag);
    
    this.emit(Opcodes.CREATE_ELEMENT, tagIdx, nodeIdx);

    for (const [key, value] of Object.entries(node.attributes)) {
      const keyIdx = this.getConstant(key);
      const valIdx = this.getConstant(value);
      const reg = this.nextRegIdx++;
      this.emit(Opcodes.LOAD_CONST, reg, valIdx);
      this.emit(Opcodes.SET_ATTRIBUTE, nodeIdx, keyIdx, reg);
    }

    for (const child of node.children) {
      const childIdx = this.compileNode(child);
      this.emit(Opcodes.APPEND_CHILD, nodeIdx, childIdx);
    }

    for (const [event, handlerStr] of Object.entries(node.events)) {
      const eventIdx = this.getConstant(event);
      const bindInstIdx = this.bytecode.length;
      this.emit(Opcodes.BIND_EVENT, nodeIdx, eventIdx, 0); 
      this.eventHandlers.push({ nodeIdx, eventIdx, handlerStr: handlerStr as string, bindInstIdx });
    }

    return nodeIdx;
  }

  private compileText(node: any): number {
    const nodeIdx = this.nextNodeIdx++;
    const textIdx = this.getConstant(node.content);
    this.emit(Opcodes.CREATE_TEXT, textIdx, nodeIdx);
    return nodeIdx;
  }

  private compileInterpolation(node: any): number {
    const nodeIdx = this.nextNodeIdx++;
    
    const textIdx = this.getConstant('');
    this.emit(Opcodes.CREATE_TEXT, textIdx, nodeIdx);

    const rewritten = this.rewriteExpression(node.expression);
    const thunk = new Function('regs', `return ${rewritten}`);
    
    const thunkIdx = this.getConstant(thunk);
    const reg = this.nextRegIdx++;
    
    this.updates.push({ nodeIdx, reg, thunkIdx });

    return nodeIdx;
  }

  private getConstant(value: any): number {
    const idx = this.constants.indexOf(value);
    if (idx !== -1) return idx;
    this.constants.push(value);
    return this.constants.length - 1;
  }

  private emit(op: import('@register-vm-reactivity-engine/vm').Opcode, a = 0, b = 0, c = 0) {
    this.bytecode.push(encodeInstruction(op, a, b, c));
  }

  private emit24(op: import('@register-vm-reactivity-engine/vm').Opcode, offset: number) {
    this.bytecode.push(this.encodeInstruction24(op, offset));
  }

  private encodeInstruction24(op: number, arg24: number): number {
    return ((op & 0xFF) << 24) | (arg24 & 0xFFFFFF);
  }
}

export function compile(ast: ASTNode[]): CompiledProgram {
  const compiler = new Compiler();
  return compiler.compile(ast);
}
