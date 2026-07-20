import { Opcodes, encodeInstruction } from '../vm/index.js';
import type { ASTNode } from '../parser/index.js';
import * as acorn from 'acorn';
import { walk } from 'estree-walker';

export interface CompiledProgram {
  bytecode: Uint32Array;
  constants: any[];
  updateBlockOffset: number;
}

const JS_GLOBALS = new Set([
  'console', 'window', 'document', 'globalThis', 'Math', 'Date', 'Array', 'Object',
  'String', 'Number', 'Boolean', 'JSON', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Promise', 'Error', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI',
  'encodeURIComponent', 'decodeURI', 'decodeURIComponent', 'event', 'undefined',
  'null', 'true', 'false', 'this', 'NaN', 'Infinity', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval'
]);

/**
 * DriftJS Compiler for compiling AST nodes into VM bytecode programs.
 */
export class DriftJSCompiler {
  private bytecode: number[] = [];
  private constants: any[] = [];
  private constantMap: Map<any, number> = new Map();
  private nextNodeIdx = 0;
  private nextRegIdx = 1;
  private varToReg: Map<string, number> = new Map();

  private updates: { nodeIdx: number, reg: number, thunkIdx: number, depMask: number, attrKeyIdx?: number, isProperty?: boolean }[] = [];
  private eventHandlers: { nodeIdx: number, eventIdx: number, handlerStr: string, bindInstIdx: number }[] = [];

  /**
   * Initializes a new compiler instance.
   *
   * @param ast - The AST nodes array to compile.
   */
  constructor(private readonly ast: ASTNode[]) {}

  private getRegForVar(name: string): number {
    return this.varToReg.get(name)!;
  }

  private createThunk(code: string): Function {
    const thunk = new Function('regs', 'vm', code);
    // Eagerly execute thunk once to force V8 JIT compilation at compile time
    try {
      const dummy = new Array(Math.max(256, this.nextRegIdx + 16)).fill(0);
      thunk(dummy, null);
    } catch (_) {}
    return thunk;
  }

  private rewriteExpression(expr: string, isEventHandler = false): { rewritten: string, depMask: number } {
    const jsAst = acorn.parse(expr, { ecmaVersion: 2020, allowReturnOutsideFunction: true });
    const replacements: { start: number, end: number, text: string }[] = [];
    let depMask = 0;

    const localScopes: Set<string>[] = [new Set()];
    if (isEventHandler) {
      localScopes[0]!.add('e');
      localScopes[0]!.add('event');
    }

    const isLocal = (name: string): boolean => {
      for (let i = localScopes.length - 1; i >= 0; i--) {
        if (localScopes[i]!.has(name)) return true;
      }
      return false;
    };

    const collectParams = (params: any[], targetSet: Set<string>) => {
      if (!params) return;
      for (const param of params) {
        if (param.type === 'Identifier') {
          targetSet.add(param.name);
        } else if (param.type === 'AssignmentPattern' && param.left && param.left.type === 'Identifier') {
          targetSet.add(param.left.name);
        } else if (param.type === 'RestElement' && param.argument && param.argument.type === 'Identifier') {
          targetSet.add(param.argument.name);
        } else if (param.type === 'ObjectPattern') {
          for (const prop of param.properties) {
            if (prop.value && prop.value.type === 'Identifier') targetSet.add(prop.value.name);
          }
        } else if (param.type === 'ArrayPattern') {
          for (const elt of param.elements) {
            if (elt && elt.type === 'Identifier') targetSet.add(elt.name);
          }
        }
      }
    };

    walk(jsAst as any, {
      enter: (node: any, parent: any) => {
        if (
          node.type === 'ArrowFunctionExpression' ||
          node.type === 'FunctionExpression' ||
          node.type === 'FunctionDeclaration'
        ) {
          const scope = new Set<string>();
          collectParams(node.params, scope);
          localScopes.push(scope);
        } else if (
          node.type === 'BlockStatement' ||
          node.type === 'ForStatement' ||
          node.type === 'ForInStatement' ||
          node.type === 'ForOfStatement' ||
          node.type === 'CatchClause'
        ) {
          localScopes.push(new Set());
        }

        if (node.type === 'VariableDeclarator' && node.id && node.id.type === 'Identifier') {
          localScopes[localScopes.length - 1]!.add(node.id.name);
        }

        if (node.type === 'UpdateExpression') {
          if (node.argument && node.argument.type === 'Identifier' && !isLocal(node.argument.name)) {
            if (this.varToReg.has(node.argument.name)) {
              const reg = this.getRegForVar(node.argument.name);
              replacements.push({ start: node.start, end: node.start, text: `(vm?.markDirty(${reg}), ` });
              replacements.push({ start: node.end, end: node.end, text: `)` });
            }
          }
        }

        if (node.type === 'AssignmentExpression') {
          if (node.left && node.left.type === 'Identifier' && !isLocal(node.left.name)) {
            if (this.varToReg.has(node.left.name)) {
              const reg = this.getRegForVar(node.left.name);
              replacements.push({ start: node.start, end: node.start, text: `(vm?.markDirty(${reg}), ` });
              replacements.push({ start: node.end, end: node.end, text: `)` });
            }
          }
        }

        if (node.type === 'Identifier') {
          if (parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
          if (parent && parent.type === 'Property' && parent.key === node && !parent.computed) return;
          if (parent && (parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' || parent.type === 'ArrowFunctionExpression') && parent.id === node) return;

          if (isLocal(node.name)) {
            return;
          }

          if (this.varToReg.has(node.name)) {
            const reg = this.getRegForVar(node.name);
            depMask |= (1 << (reg % 32));
            replacements.push({ start: node.start, end: node.end, text: `regs[${reg}]` });
          } else if (!JS_GLOBALS.has(node.name)) {
            throw new Error(`Variable "${node.name}" is not defined in state`);
          }
        }
      },
      leave: (node: any) => {
        if (
          node.type === 'ArrowFunctionExpression' ||
          node.type === 'FunctionExpression' ||
          node.type === 'FunctionDeclaration' ||
          node.type === 'BlockStatement' ||
          node.type === 'ForStatement' ||
          node.type === 'ForInStatement' ||
          node.type === 'ForOfStatement' ||
          node.type === 'CatchClause'
        ) {
          localScopes.pop();
        }
      }
    });

    replacements.sort((a, b) => a.start - b.start || a.end - b.end);
    let rewritten = '';
    let lastEnd = 0;
    for (const rep of replacements) {
      if (rep.start >= lastEnd) {
        rewritten += expr.slice(lastEnd, rep.start) + rep.text;
        lastEnd = Math.max(lastEnd, rep.end);
      }
    }
    rewritten += expr.slice(lastEnd);
    return { rewritten, depMask };
  }

  private compileScript(scriptNode: any): number {
    const jsAst = acorn.parse(scriptNode.content, { ecmaVersion: 2020 });
    
    // First pass: Discover all top-level state variables, functions, and classes
    if (Array.isArray(jsAst.body)) {
      for (const node of jsAst.body as any[]) {
        if (node.type === 'VariableDeclaration') {
          for (const decl of node.declarations) {
            if (decl.id && decl.id.type === 'Identifier') {
              if (!this.varToReg.has(decl.id.name)) {
                this.varToReg.set(decl.id.name, this.nextRegIdx++);
              }
            }
          }
        } else if (
          (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') &&
          node.id && node.id.type === 'Identifier'
        ) {
          if (!this.varToReg.has(node.id.name)) {
            this.varToReg.set(node.id.name, this.nextRegIdx++);
          }
        }
      }
    }

    // Second pass: Collect replacements for declarations, functions, and identifiers
    const replacements: { start: number, end: number, text: string }[] = [];
    const localScopes: Set<string>[] = [new Set()];

    const isLocal = (name: string): boolean => {
      for (let i = localScopes.length - 1; i >= 0; i--) {
        if (localScopes[i]!.has(name)) return true;
      }
      return false;
    };

    const collectParams = (params: any[], targetSet: Set<string>) => {
      if (!params) return;
      for (const param of params) {
        if (param.type === 'Identifier') {
          targetSet.add(param.name);
        } else if (param.type === 'AssignmentPattern' && param.left && param.left.type === 'Identifier') {
          targetSet.add(param.left.name);
        } else if (param.type === 'RestElement' && param.argument && param.argument.type === 'Identifier') {
          targetSet.add(param.argument.name);
        } else if (param.type === 'ObjectPattern') {
          for (const prop of param.properties) {
            if (prop.value && prop.value.type === 'Identifier') targetSet.add(prop.value.name);
          }
        } else if (param.type === 'ArrayPattern') {
          for (const elt of param.elements) {
            if (elt && elt.type === 'Identifier') targetSet.add(elt.name);
          }
        }
      }
    };

    walk(jsAst as any, {
      enter: (node: any, parent: any) => {
        if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id && node.id.type === 'Identifier') {
          if (localScopes.length === 1 && this.varToReg.has(node.id.name)) {
            const reg = this.getRegForVar(node.id.name);
            replacements.push({ start: node.start, end: node.start, text: `regs[${reg}] = (` });
            replacements.push({ start: node.end, end: node.end, text: `);` });
          }
        }

        if (node.type === 'VariableDeclaration') {
          if (localScopes.length === 1) {
            replacements.push({
              start: node.start,
              end: node.declarations[0].start,
              text: ' '.repeat(node.declarations[0].start - node.start)
            });
          }
        }

        if (node.type === 'VariableDeclarator') {
          if (localScopes.length > 1 && node.id && node.id.type === 'Identifier') {
            localScopes[localScopes.length - 1]!.add(node.id.name);
          }
        }

        if (
          node.type === 'ArrowFunctionExpression' ||
          node.type === 'FunctionExpression' ||
          node.type === 'FunctionDeclaration'
        ) {
          const scope = new Set<string>();
          collectParams(node.params, scope);
          localScopes.push(scope);
        } else if (
          node.type === 'BlockStatement' ||
          node.type === 'ForStatement' ||
          node.type === 'ForInStatement' ||
          node.type === 'ForOfStatement' ||
          node.type === 'CatchClause'
        ) {
          localScopes.push(new Set());
        }

        if (node.type === 'UpdateExpression') {
          if (node.argument && node.argument.type === 'Identifier' && !isLocal(node.argument.name)) {
            if (this.varToReg.has(node.argument.name)) {
              const reg = this.getRegForVar(node.argument.name);
              replacements.push({ start: node.start, end: node.start, text: `(vm?.markDirty(${reg}), ` });
              replacements.push({ start: node.end, end: node.end, text: `)` });
            }
          }
        }

        if (node.type === 'AssignmentExpression') {
          if (node.left && node.left.type === 'Identifier' && !isLocal(node.left.name)) {
            if (this.varToReg.has(node.left.name)) {
              const reg = this.getRegForVar(node.left.name);
              replacements.push({ start: node.start, end: node.start, text: `(vm?.markDirty(${reg}), ` });
              replacements.push({ start: node.end, end: node.end, text: `)` });
            }
          }
        }

        if (node.type === 'ExpressionStatement') {
          if (node.expression && node.expression.type === 'CallExpression') {
            replacements.push({ start: node.end, end: node.end, text: `; vm?.requestUpdate();` });
          }
        }

        if (node.type === 'Identifier') {
          if (parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
          if (parent && parent.type === 'Property' && parent.key === node && !parent.computed) return;
          if (parent && (parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' || parent.type === 'ArrowFunctionExpression') && parent.id === node) return;

          if (isLocal(node.name)) {
            return;
          }

          if (this.varToReg.has(node.name)) {
            const reg = this.getRegForVar(node.name);
            replacements.push({ start: node.start, end: node.end, text: `regs[${reg}]` });
          }
        }
      },
      leave: (node: any) => {
        if (
          node.type === 'ArrowFunctionExpression' ||
          node.type === 'FunctionExpression' ||
          node.type === 'FunctionDeclaration' ||
          node.type === 'BlockStatement' ||
          node.type === 'ForStatement' ||
          node.type === 'ForInStatement' ||
          node.type === 'ForOfStatement' ||
          node.type === 'CatchClause'
        ) {
          localScopes.pop();
        }
      }
    });

    replacements.sort((a, b) => a.start - b.start || a.end - b.end);
    let rewritten = '';
    let lastEnd = 0;
    const content = scriptNode.content;
    for (const rep of replacements) {
      if (rep.start >= lastEnd) {
        rewritten += content.slice(lastEnd, rep.start) + rep.text;
        lastEnd = Math.max(lastEnd, rep.end);
      }
    }
    rewritten += content.slice(lastEnd);

    const thunk = this.createThunk(rewritten);
    return this.getConstant(thunk);
  }

  /**
   * Compiles the AST into a compiled VM program.
   *
   * @returns The compiled bytecode program and constants array.
   */
  public compile(): CompiledProgram {
    // Reset compilation state for fresh compilation run
    this.bytecode = [];
    this.constants = [];
    this.constantMap = new Map();
    this.nextNodeIdx = 0;
    this.nextRegIdx = 1;
    this.varToReg = new Map();
    this.updates = [];
    this.eventHandlers = [];

    const scriptNodes = this.ast.filter(n => n.type === 'Script');
    
    // First, compile scripts to populate varToReg
    const scriptThunkIndices: number[] = [];
    for (const script of scriptNodes) {
      scriptThunkIndices.push(this.compileScript(script));
    }

    const rootNodes = this.ast.filter(n => n.type !== 'Script').map(node => this.compileNode(node));

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
      this.emit(Opcodes.EXEC_THUNK, up.reg, up.thunkIdx, up.depMask);
      if (up.attrKeyIdx !== undefined) {
        const op = up.isProperty ? Opcodes.SET_PROPERTY : Opcodes.SET_ATTRIBUTE;
        this.emit(op, up.nodeIdx, up.attrKeyIdx, up.reg);
      } else {
        this.emit(Opcodes.SET_TEXT, up.nodeIdx, up.reg);
      }
    }
    this.emit(Opcodes.RETURN); 

    for (const handler of this.eventHandlers) {
      const handlerOffset = this.bytecode.length;
      this.bytecode[handler.bindInstIdx] = encodeInstruction(Opcodes.BIND_EVENT, handler.nodeIdx, handler.eventIdx, handlerOffset);

      let handlerStr = handler.handlerStr.trim();
      if (handlerStr.startsWith('{') && handlerStr.endsWith('}')) {
        handlerStr = handlerStr.slice(1, -1).trim();
      }
      handlerStr = handlerStr.replace(/;+\s*$/, '').trim();

      const { rewritten } = this.rewriteExpression(handlerStr, true);
      const thunkCode = `
        const e = regs[0];
        const event = regs[0];
        try {
          const fn = (${rewritten});
          if (typeof fn === 'function') {
            fn(regs[0], vm);
          }
        } catch (_) {}
      `;
      const thunk = this.createThunk(thunkCode);
      const thunkIdx = this.getConstant(thunk);
      
      this.emit(Opcodes.EXEC_THUNK, 0, thunkIdx);
      this.emit24(Opcodes.JUMP, updateBlockOffset); 
    }

    const endOfProgramOffset = this.bytecode.length;
    this.bytecode[endOfMountJumpIdx] = this.encodeInstruction24(Opcodes.JUMP, updateBlockOffset);

    return {
      bytecode: new Uint32Array(this.bytecode),
      constants: this.constants,
      updateBlockOffset,
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
      const valStr = (value as string).trim();
      const isProperty = key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected';
      const setOpcode = isProperty ? Opcodes.SET_PROPERTY : Opcodes.SET_ATTRIBUTE;

      if (valStr.startsWith('{') && valStr.endsWith('}')) {
        const expr = valStr.slice(1, -1).trim();
        const { rewritten, depMask } = this.rewriteExpression(expr);
        const thunk = this.createThunk(`return ${rewritten}`);
        const thunkIdx = this.getConstant(thunk);
        const reg = this.nextRegIdx++;
        
        this.emit(Opcodes.EXEC_THUNK, reg, thunkIdx);
        this.emit(setOpcode, nodeIdx, keyIdx, reg);
        this.updates.push({ nodeIdx, reg, thunkIdx, depMask, attrKeyIdx: keyIdx, isProperty });
      } else {
        const valIdx = this.getConstant(value);
        const reg = this.nextRegIdx++;
        this.emit(Opcodes.LOAD_CONST, reg, valIdx);
        this.emit(setOpcode, nodeIdx, keyIdx, reg);
      }
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

    const { rewritten, depMask } = this.rewriteExpression(node.expression);
    const thunk = this.createThunk(`return ${rewritten}`);
    
    const thunkIdx = this.getConstant(thunk);
    const reg = this.nextRegIdx++;
    
    this.updates.push({ nodeIdx, reg, thunkIdx, depMask });

    return nodeIdx;
  }

  private getConstant(value: any): number {
    const existing = this.constantMap.get(value);
    if (existing !== undefined) return existing;
    const idx = this.constants.length;
    this.constants.push(value);
    this.constantMap.set(value, idx);
    return idx;
  }

  private emit(op: import('../vm/index.js').Opcode, a = 0, b = 0, c = 0) {
    this.bytecode.push(encodeInstruction(op, a, b, c));
  }

  private emit24(op: import('../vm/index.js').Opcode, offset: number) {
    this.bytecode.push(this.encodeInstruction24(op, offset));
  }

  private encodeInstruction24(op: number, arg24: number): number {
    return ((op & 0xFF) << 24) | (arg24 & 0xFFFFFF);
  }
}

/**
 * Convenience function to compile an AST node array into a compiled VM program.
 *
 * @param ast - The AST nodes array to compile.
 * @returns The compiled bytecode program and constants array.
 */
export function compile(ast: ASTNode[]): CompiledProgram {
  const compiler = new DriftJSCompiler(ast);
  return compiler.compile();
}
