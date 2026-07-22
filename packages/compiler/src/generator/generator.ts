import { Opcodes, encodeInstruction, type Opcode } from '@driftjs/runtime';
import type { ASTNode, ElementNode, TextNode, InterpolationNode, ScriptNode, CompiledProgram } from '../../types/index.js';
import { DriftJSAnalyzer } from '../analyzer/index.js';

/**
 * DriftJS AST Bytecode Generator.
 * Consumes AST nodes and analyzed scope metadata to produce 32-bit instructions and constants pool.
 */
export class DriftJSGenerator {
  private bytecode: number[] = [];
  private constants: unknown[] = [];
  private constantMap: Map<unknown, number> = new Map();
  private nextNodeIdx = 1;
  private nextRegIdx = 1;
  private analyzer: DriftJSAnalyzer;

  private updates: { nodeIdx: number; reg: number; thunkIdx: number; depMask: number; attrKeyIdx?: number; isProperty?: boolean }[] = [];
  private ifSubroutineOffsets: number[] = [];
  private eventHandlers: { nodeIdx: number; eventIdx: number; handlerStr: string; bindInstIdx: number }[] = [];

  /**
   * Initializes a new generator instance.
   *
   * @param ast - The AST nodes array to compile into bytecode.
   */
  constructor(private readonly ast: ASTNode[]) {
    this.analyzer = new DriftJSAnalyzer(ast);
  }

  public generate(): CompiledProgram {
    const analysis = this.analyzer.analyze();
    this.nextRegIdx = analysis.nextRegIdx;

    this.bytecode = [];
    this.constants = [];
    this.constantMap = new Map();
    this.nextNodeIdx = 1;
    this.updates = [];
    this.ifSubroutineOffsets = [];
    this.eventHandlers = [];

    const scriptThunkIndices: number[] = [];
    for (const thunkCode of analysis.scriptThunkCodes) {
      const thunkFn = this.analyzer.createThunk(thunkCode);
      scriptThunkIndices.push(this.getConstant(thunkFn));
    }

    // Emit script thunks at the beginning so state variables are initialized before element creation
    for (const thunkIdx of scriptThunkIndices) {
      this.emit(Opcodes.EXEC_THUNK, 0, thunkIdx);
    }

    const rootNodes = this.ast
      .filter((n): n is ElementNode | TextNode | InterpolationNode | import('../../types/index.js').IfBlockNode => n.type !== 'Script')
      .map(node => this.compileNode(node, 0));

    for (const rootIdx of rootNodes) {
      this.emit(Opcodes.MOUNT, rootIdx);
    }

    const endOfMountJumpIdx = this.bytecode.length;
    this.emit24(Opcodes.JUMP, 0); 

    const updateBlockOffset = this.bytecode.length;
    for (const up of this.updates) {
      this.emit(Opcodes.EXEC_THUNK, up.reg, up.thunkIdx, up.depMask);
      if (up.attrKeyIdx !== undefined) {
        const setOpcode = up.isProperty ? Opcodes.SET_PROPERTY : Opcodes.SET_ATTRIBUTE;
        this.emit(setOpcode, up.nodeIdx, up.attrKeyIdx, up.reg);
      } else {
        this.emit(Opcodes.SET_TEXT, up.nodeIdx, up.reg);
      }
    }

    for (const subOffset of this.ifSubroutineOffsets) {
      this.emit24(Opcodes.CALL, subOffset);
    }

    this.emit(Opcodes.RETURN); 

    for (const handler of this.eventHandlers) {
      const handlerOffset = this.bytecode.length;
      const { rewritten } = this.analyzer.rewriteExpression(handler.handlerStr, true);
      const cleaned = rewritten.trim().replace(/;+$/, '');
      const thunkFn = this.analyzer.createThunk(`
        try {
          const __h = (${cleaned});
          if (typeof __h === 'function') {
            return __h.call(vm, regs[0]);
          }
          return __h;
        } catch (e) {
          ${rewritten}
        }
      `);
      const thunkIdx = this.getConstant(thunkFn);

      this.emit(Opcodes.EXEC_THUNK, 0, thunkIdx);
      this.emit(Opcodes.RETURN);

      this.bytecode[handler.bindInstIdx] = encodeInstruction(
        Opcodes.BIND_EVENT,
        handler.nodeIdx,
        handler.eventIdx,
        handlerOffset
      );
    }

    this.bytecode[endOfMountJumpIdx] = encodeInstruction(
      Opcodes.JUMP,
      0,
      (updateBlockOffset >> 8) & 0xFF,
      updateBlockOffset & 0xFF
    );

    return {
      bytecode: new Uint32Array(this.bytecode),
      constants: this.constants,
      updateBlockOffset
    };
  }

  private compileNode(node: ASTNode, parentNodeIdx = 0): number {
    switch (node.type) {
      case 'Element':
        return this.compileElement(node);
      case 'Text':
        return this.compileText(node);
      case 'Interpolation':
        return this.compileInterpolation(node);
      case 'IfBlock':
        return this.compileIfBlock(node, parentNodeIdx);
      case 'ForBlock':
        return this.compileForBlock(node, parentNodeIdx);
      case 'Script':
        throw new Error('Script node compilation must occur prior to DOM tree walk');
      default:
        throw new Error(`Unknown AST node type: ${(node as any).type}`);
    }
  }

  private compileIfBlock(node: import('../../types/index.js').IfBlockNode, parentNodeIdx = 0): number {
    const anchorNodeIdx = this.nextNodeIdx++;
    const commentTextIdx = this.getConstant('drift-if-anchor');
    this.emit(Opcodes.CREATE_COMMENT, commentTextIdx, anchorNodeIdx);
    if (parentNodeIdx === 0) {
      this.emit(Opcodes.MOUNT, anchorNodeIdx);
    } else {
      this.emit(Opcodes.APPEND_CHILD, parentNodeIdx, anchorNodeIdx);
    }

    const { rewritten, depMask } = this.analyzer.rewriteExpression(node.condition);
    const thunkFn = this.analyzer.createThunk(`return ${rewritten}`);
    const thunkIdx = this.getConstant(thunkFn);

    const condReg = this.nextRegIdx++;
    const branchStateReg = this.nextRegIdx++;
    const regOne = this.nextRegIdx++;
    const regTwo = this.nextRegIdx++;

    const constOneIdx = this.getConstant(1);
    const constTwoIdx = this.getConstant(2);
    this.emit(Opcodes.LOAD_CONST, regOne, constOneIdx);
    this.emit(Opcodes.LOAD_CONST, regTwo, constTwoIdx);

    // Create DOM nodes for consequent and alternate branches
    const consequentNodeIndices: number[] = [];
    const alternateNodeIndices: number[] = [];

    for (const child of node.consequent) {
      if (child.type !== 'Script') {
        const childIdx = this.compileNode(child, parentNodeIdx);
        consequentNodeIndices.push(childIdx);
      }
    }

    if (node.alternate) {
      for (const child of node.alternate) {
        if (child.type !== 'Script') {
          const childIdx = this.compileNode(child, parentNodeIdx);
          alternateNodeIndices.push(childIdx);
        }
      }
    }

    const subroutineOffset = this.bytecode.length + 2;
    this.ifSubroutineOffsets.push(subroutineOffset);

    // Call subroutine during Mount, then jump over subroutine body
    this.emit24(Opcodes.CALL, subroutineOffset);
    const jumpOverSubroutineIdx = this.bytecode.length;
    this.emit24(Opcodes.JUMP, 0);

    // Subroutine body (starts at subroutineOffset)
    this.emit(Opcodes.EXEC_THUNK, condReg, thunkIdx, 0);

    const jumpToElseInstIdx = this.bytecode.length;
    this.emit(Opcodes.JUMP_IF_FALSE, condReg, 0, 0);

    // --- CONSEQUENT BRANCH ---
    const jumpSameConsInstIdx = this.bytecode.length;
    this.emit(Opcodes.JUMP_IF_EQUAL, branchStateReg, regOne, 0);

    // Remove alternate branch nodes if active
    for (const altIdx of alternateNodeIndices) {
      this.emit(Opcodes.REMOVE_CHILD, parentNodeIdx, altIdx);
    }
    // Insert consequent branch nodes
    for (const consIdx of consequentNodeIndices) {
      this.emit(Opcodes.INSERT_BEFORE, parentNodeIdx, consIdx, anchorNodeIdx);
    }
    this.emit(Opcodes.LOAD_CONST, branchStateReg, constOneIdx);

    const consUpdateOffset = this.bytecode.length;
    this.bytecode[jumpSameConsInstIdx] = encodeInstruction(
      Opcodes.JUMP_IF_EQUAL,
      branchStateReg,
      regOne,
      consUpdateOffset
    );

    const jumpToEndInstIdx = this.bytecode.length;
    this.emit24(Opcodes.JUMP, 0);

    // --- ALTERNATE BRANCH ---
    const elseOffset = this.bytecode.length;
    this.bytecode[jumpToElseInstIdx] = encodeInstruction(
      Opcodes.JUMP_IF_FALSE,
      condReg,
      (elseOffset >> 8) & 0xFF,
      elseOffset & 0xFF
    );

    const jumpSameAltInstIdx = this.bytecode.length;
    this.emit(Opcodes.JUMP_IF_EQUAL, branchStateReg, regTwo, 0);

    // Remove consequent branch nodes if active
    for (const consIdx of consequentNodeIndices) {
      this.emit(Opcodes.REMOVE_CHILD, parentNodeIdx, consIdx);
    }
    // Insert alternate branch nodes
    for (const altIdx of alternateNodeIndices) {
      this.emit(Opcodes.INSERT_BEFORE, parentNodeIdx, altIdx, anchorNodeIdx);
    }
    this.emit(Opcodes.LOAD_CONST, branchStateReg, constTwoIdx);

    const altUpdateOffset = this.bytecode.length;
    this.bytecode[jumpSameAltInstIdx] = encodeInstruction(
      Opcodes.JUMP_IF_EQUAL,
      branchStateReg,
      regTwo,
      altUpdateOffset
    );

    const endOffset = this.bytecode.length;
    this.bytecode[jumpToEndInstIdx] = encodeInstruction(
      Opcodes.JUMP,
      0,
      (endOffset >> 8) & 0xFF,
      endOffset & 0xFF
    );

    this.emit(Opcodes.RETURN);

    const afterSubroutineOffset = this.bytecode.length;
    this.bytecode[jumpOverSubroutineIdx] = encodeInstruction(
      Opcodes.JUMP,
      0,
      (afterSubroutineOffset >> 8) & 0xFF,
      afterSubroutineOffset & 0xFF
    );

    return anchorNodeIdx;
  }

  private compileForBodyToJS(nodes: ASTNode[], itemVar: string, indexVar?: string): string {
    const localVars = [itemVar, ...(indexVar ? [indexVar] : [])];

    const evalExpr = (expr: string): string => {
      const { rewritten } = this.analyzer.rewriteExpression(expr, false, localVars);
      const params = ['regs', itemVar, ...(indexVar ? [indexVar] : [])];
      const args = ['regs', `scope[${JSON.stringify(itemVar)}]`, ...(indexVar ? [`scope[${JSON.stringify(indexVar)}]`] : [])];
      const cleaned = rewritten.trim().replace(/;+$/, '');
      return `(new Function(${params.map(p => JSON.stringify(p)).join(', ')}, "return (" + ${JSON.stringify(cleaned)} + ")"))(${args.join(', ')})`;
    };

    let js = '';
    for (const node of nodes) {
      if (node.type === 'Element') {
        js += `const el = document.createElement(${JSON.stringify(node.tag)});\n`;
        for (const [k, v] of Object.entries(node.attributes)) {
          let valExpr = JSON.stringify(v);
          if (v.startsWith('{') && v.endsWith('}')) {
            valExpr = evalExpr(v.slice(1, -1));
          }
          js += `el.setAttribute(${JSON.stringify(k)}, String(${valExpr} ?? ''));\n`;
        }
        for (const child of node.children) {
          if (child.type === 'Text') {
            js += `el.appendChild(document.createTextNode(${JSON.stringify(child.content)}));\n`;
          } else if (child.type === 'Interpolation') {
            const valExpr = evalExpr(child.expression);
            js += `el.appendChild(document.createTextNode(String(${valExpr} ?? '')));\n`;
          }
        }
        js += `parent.insertBefore(el, anchor);\nnewNodes.push(el);\n`;
      } else if (node.type === 'Text') {
        js += `const t = document.createTextNode(${JSON.stringify(node.content)});\nparent.insertBefore(t, anchor);\nnewNodes.push(t);\n`;
      } else if (node.type === 'Interpolation') {
        const valExpr = evalExpr(node.expression);
        js += `const t = document.createTextNode(String(${valExpr} ?? ''));\nparent.insertBefore(t, anchor);\nnewNodes.push(t);\n`;
      }
    }
    return js;
  }

  private compileForBlock(node: import('../../types/index.js').ForBlockNode, parentNodeIdx = 0): number {
    const anchorNodeIdx = this.nextNodeIdx++;
    const commentTextIdx = this.getConstant('drift-for-anchor');
    this.emit(Opcodes.CREATE_COMMENT, commentTextIdx, anchorNodeIdx);
    if (parentNodeIdx === 0) {
      this.emit(Opcodes.MOUNT, anchorNodeIdx);
    } else {
      this.emit(Opcodes.APPEND_CHILD, parentNodeIdx, anchorNodeIdx);
    }

    const { rewritten: iterableRewritten, depMask } = this.analyzer.rewriteExpression(node.iterable, false);
    const bodyJS = this.compileForBodyToJS(node.body, node.item, node.index);

    const thunkCode = `
      const list = (${iterableRewritten}) || [];
      const parent = (nodes && nodes[${parentNodeIdx}]) || (vm && vm.rootElement) || (rootElement) || (typeof document !== 'undefined' ? document.body : null);
      const anchor = nodes && nodes[${anchorNodeIdx}];
      if (!parent || !anchor) return;
      if (anchor.parentNode !== parent) {
        parent.appendChild(anchor);
      }

      if (vm) {
        if (!vm._forNodes) vm._forNodes = new Map();
        const oldNodes = vm._forNodes.get(${anchorNodeIdx}) || [];
        for (const n of oldNodes) {
          if (n && n.parentNode === parent) {
            parent.removeChild(n);
          }
        }
      }

      const newNodes = [];
      const itemVar = ${JSON.stringify(node.item)};
      const indexVar = ${JSON.stringify(node.index || null)};

      for (let i = 0; i < list.length; i++) {
        const itemVal = list[i];
        const indexVal = i;
        const scope = { [itemVar]: itemVal };
        if (indexVar) scope[indexVar] = indexVal;

        ${bodyJS}
      }

      if (vm && vm._forNodes) {
        vm._forNodes.set(${anchorNodeIdx}, newNodes);
      }
    `;

    const thunkFn = new Function('regs', 'vm', 'nodes', 'rootElement', thunkCode);
    const thunkIdx = this.getConstant(thunkFn);

    const arrReg = this.nextRegIdx++;
    this.emit(Opcodes.EXEC_THUNK, arrReg, thunkIdx, 0);

    this.updates.push({
      nodeIdx: anchorNodeIdx,
      reg: arrReg,
      thunkIdx,
      depMask
    });

    return anchorNodeIdx;
  }

  private compileElement(node: ElementNode): number {
    const tagIdx = this.getConstant(node.tag);
    const nodeIdx = this.nextNodeIdx++;

    this.emit(Opcodes.CREATE_ELEMENT, tagIdx, nodeIdx);

    for (const [key, value] of Object.entries(node.attributes)) {
      const keyIdx = this.getConstant(key);
      const valStr = value.trim();

      const isProperty = key === 'value' || key === 'checked' || key === 'disabled';
      const setOpcode = isProperty ? Opcodes.SET_PROPERTY : Opcodes.SET_ATTRIBUTE;

      if (valStr.startsWith('{') && valStr.endsWith('}')) {
        const expr = valStr.slice(1, -1).trim();
        const { rewritten, depMask } = this.analyzer.rewriteExpression(expr);
        const thunkFn = this.analyzer.createThunk(`return ${rewritten}`);
        const thunkIdx = this.getConstant(thunkFn);
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
      if (child.type !== 'Script') {
        const childIdx = this.compileNode(child, nodeIdx);
        if (child.type !== 'IfBlock' && child.type !== 'ForBlock') {
          this.emit(Opcodes.APPEND_CHILD, nodeIdx, childIdx);
        }
      }
    }

    for (const [event, handlerStr] of Object.entries(node.events)) {
      const eventIdx = this.getConstant(event);
      const bindInstIdx = this.bytecode.length;
      this.emit(Opcodes.BIND_EVENT, nodeIdx, eventIdx, 0); 
      this.eventHandlers.push({ nodeIdx, eventIdx, handlerStr, bindInstIdx });
    }

    return nodeIdx;
  }

  private compileText(node: TextNode): number {
    const nodeIdx = this.nextNodeIdx++;
    const textIdx = this.getConstant(node.content);
    this.emit(Opcodes.CREATE_TEXT, textIdx, nodeIdx);
    return nodeIdx;
  }

  private compileInterpolation(node: InterpolationNode): number {
    const nodeIdx = this.nextNodeIdx++;
    
    const textIdx = this.getConstant('');
    this.emit(Opcodes.CREATE_TEXT, textIdx, nodeIdx);

    const { rewritten, depMask } = this.analyzer.rewriteExpression(node.expression);
    const thunkFn = this.analyzer.createThunk(`return ${rewritten}`);
    
    const thunkIdx = this.getConstant(thunkFn);
    const reg = this.nextRegIdx++;

    this.emit(Opcodes.EXEC_THUNK, reg, thunkIdx);
    this.emit(Opcodes.SET_TEXT, nodeIdx, reg);
    
    this.updates.push({ nodeIdx, reg, thunkIdx, depMask });

    return nodeIdx;
  }

  private getConstant(value: unknown): number {
    const existing = this.constantMap.get(value);
    if (existing !== undefined) return existing;
    const idx = this.constants.length;
    this.constants.push(value);
    this.constantMap.set(value, idx);
    return idx;
  }

  private emit(op: Opcode, a = 0, b = 0, c = 0): void {
    this.bytecode.push(encodeInstruction(op, a, b, c));
  }

  private emit24(op: Opcode, arg24 = 0): void {
    this.bytecode.push((op << 24) | (arg24 & 0xFFFFFF));
  }
}

/**
 * Convenience function to compile AST nodes directly into a bytecode program.
 *
 * @param ast - The AST node array.
 * @returns Compiled program.
 */
export function generate(ast: ASTNode[]): CompiledProgram {
  const gen = new DriftJSGenerator(ast);
  return gen.generate();
}


