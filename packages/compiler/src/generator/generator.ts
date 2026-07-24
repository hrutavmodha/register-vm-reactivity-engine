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

  private updates: { nodeIdx: number; reg: number; thunkIdx: number; depMask: number; attrKeyIdx?: number; isProperty?: boolean; isForBlock?: boolean }[] = [];
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
      if (up.isForBlock) {
        continue;
      }
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
          console.error('Error executing event handler:', e);
        }
      `);
      const thunkIdx = this.getConstant(thunkFn);

      this.emit(Opcodes.EXEC_THUNK, 0, thunkIdx);
      this.emit(Opcodes.RETURN);

      this.bytecode[handler.bindInstIdx] = encodeInstruction(
        Opcodes.BIND_EVENT,
        handler.nodeIdx,
        handler.eventIdx,
        0
      );
      this.bytecode[handler.bindInstIdx + 1] = (Opcodes.CALL << 24) | (handlerOffset & 0xFFFFFF);
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

  private collectIfBranches(node: import('../../types/index.js').IfBlockNode): Array<{ condition?: string; consequent: ASTNode[] }> {
    const branches: Array<{ condition?: string; consequent: ASTNode[] }> = [
      { condition: node.condition, consequent: node.consequent }
    ];

    let currentAlt = node.alternate;
    while (currentAlt && currentAlt.length === 1 && currentAlt[0]!.type === 'IfBlock') {
      const nestedIf = currentAlt[0] as import('../../types/index.js').IfBlockNode;
      branches.push({ condition: nestedIf.condition, consequent: nestedIf.consequent });
      currentAlt = nestedIf.alternate;
    }

    if (currentAlt && currentAlt.length > 0) {
      branches.push({ consequent: currentAlt });
    }

    return branches;
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

    const branches = this.collectIfBranches(node);
    const branchStateReg = this.nextRegIdx++;

    // Compile DOM nodes for each branch up front
    const branchNodes: number[][] = branches.map(branch => {
      const nodeIndices: number[] = [];
      for (const child of branch.consequent) {
        if (child.type !== 'Script') {
          nodeIndices.push(this.compileNode(child, parentNodeIdx));
        }
      }
      return nodeIndices;
    });

    const subroutineOffset = this.bytecode.length + 2;
    this.ifSubroutineOffsets.push(subroutineOffset);

    // Call subroutine during Mount, then jump over subroutine body
    this.emit24(Opcodes.CALL, subroutineOffset);
    const jumpOverSubroutineIdx = this.bytecode.length;
    this.emit24(Opcodes.JUMP, 0);

    // Subroutine body (starts at subroutineOffset)
    const endJumpInstIndices: number[] = [];
    const constZeroIdx = this.getConstant(0);
    const regZero = this.nextRegIdx++;
    this.emit(Opcodes.LOAD_CONST, regZero, constZeroIdx);

    const stateRegs: number[] = [];
    const constStateIndices: number[] = [];
    for (let i = 0; i < branches.length; i++) {
      const stReg = this.nextRegIdx++;
      const cIdx = this.getConstant(i + 1);
      stateRegs.push(stReg);
      constStateIndices.push(cIdx);
      this.emit(Opcodes.LOAD_CONST, stReg, cIdx);
    }

    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i]!;
      const nodeIndices = branchNodes[i]!;
      const stateReg = stateRegs[i]!;
      const constStateIdx = constStateIndices[i]!;

      let jumpToNextBranchIdx = -1;
      let condReg = 0;
      if (branch.condition) {
        const { rewritten } = this.analyzer.rewriteExpression(branch.condition);
        const thunkFn = this.analyzer.createThunk(`return ${rewritten}`);
        const thunkIdx = this.getConstant(thunkFn);
        condReg = this.nextRegIdx++;
        this.emit(Opcodes.EXEC_THUNK, condReg, thunkIdx, 0);
        jumpToNextBranchIdx = this.bytecode.length;
        this.emit(Opcodes.JUMP_IF_FALSE, condReg, 0, 0);
      }

      const jumpAlreadyActiveIdx = this.bytecode.length;
      this.emit(Opcodes.JUMP_IF_EQUAL, branchStateReg, stateReg, 0);

      // Remove nodes from all other branches (deduplicated)
      const otherNodesToRemove = new Set<number>();
      for (let j = 0; j < branches.length; j++) {
        if (j !== i) {
          for (const otherNodeIdx of branchNodes[j]!) {
            otherNodesToRemove.add(otherNodeIdx);
          }
        }
      }
      for (const otherNodeIdx of otherNodesToRemove) {
        this.emit(Opcodes.REMOVE_CHILD, parentNodeIdx, otherNodeIdx);
      }

      // Insert current branch nodes before anchor
      for (const nodeIdx of nodeIndices) {
        this.emit(Opcodes.INSERT_BEFORE, parentNodeIdx, nodeIdx, anchorNodeIdx);
      }

      this.emit(Opcodes.LOAD_CONST, branchStateReg, constStateIdx);

      const activePatchOffset = this.bytecode.length;
      this.bytecode[jumpAlreadyActiveIdx] = encodeInstruction(
        Opcodes.JUMP_IF_EQUAL,
        branchStateReg,
        stateReg,
        activePatchOffset
      );

      endJumpInstIndices.push(this.bytecode.length);
      this.emit24(Opcodes.JUMP, 0);

      if (jumpToNextBranchIdx !== -1) {
        const nextBranchOffset = this.bytecode.length;
        this.bytecode[jumpToNextBranchIdx] = encodeInstruction(
          Opcodes.JUMP_IF_FALSE,
          condReg,
          (nextBranchOffset >> 8) & 0xFF,
          nextBranchOffset & 0xFF
        );
      }
    }

    // Fallback if no branch matched (e.g. single 'if' when condition is false)
    if (branches.some(b => b.condition)) {
      const jumpAlreadyZeroIdx = this.bytecode.length;
      this.emit(Opcodes.JUMP_IF_EQUAL, branchStateReg, regZero, 0);

      for (let j = 0; j < branches.length; j++) {
        for (const otherNodeIdx of branchNodes[j]!) {
          this.emit(Opcodes.REMOVE_CHILD, parentNodeIdx, otherNodeIdx);
        }
      }
      this.emit(Opcodes.LOAD_CONST, branchStateReg, constZeroIdx);

      const zeroPatchOffset = this.bytecode.length;
      this.bytecode[jumpAlreadyZeroIdx] = encodeInstruction(
        Opcodes.JUMP_IF_EQUAL,
        branchStateReg,
        regZero,
        zeroPatchOffset
      );
    }

    const endOffset = this.bytecode.length;
    for (const jumpIdx of endJumpInstIndices) {
      this.bytecode[jumpIdx] = encodeInstruction(
        Opcodes.JUMP,
        0,
        (endOffset >> 8) & 0xFF,
        endOffset & 0xFF
      );
    }

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

  private compileForBodyToJS(nodes: ASTNode[], itemVar: string, indexVar?: string): { createJS: string; updateJS: string } {
    const localVars = [itemVar, ...(indexVar ? [indexVar] : [])];

    const evalExpr = (expr: string): string => {
      const { rewritten } = this.analyzer.rewriteExpression(expr, false, localVars);
      const cleaned = rewritten.trim().replace(/;+$/, '');
      return `((regs, ${itemVar}${indexVar ? `, ${indexVar}` : ''}) => (${cleaned}))(regs, scope[${JSON.stringify(itemVar)}]${indexVar ? `, scope[${JSON.stringify(indexVar)}]` : ''})`;
    };

    let createJS = '';
    let updateJS = '';

    const compileElementJS = (elNode: import('../../types/index.js').ElementNode, varName: string): { createStr: string; updateStr: string } => {
      let createStr = `${varName} = document.createElement(${JSON.stringify(elNode.tag)});\n`;
      let updateStr = ``;

      for (const [k, v] of Object.entries(elNode.attributes)) {
        let valExpr = JSON.stringify(v);
        if (v.startsWith('{') && v.endsWith('}')) {
          valExpr = evalExpr(v.slice(1, -1));
        }
        const isProp = k === 'value' || k === 'checked' || k === 'disabled';
        if (isProp) {
          createStr += `${varName}[${JSON.stringify(k)}] = ${valExpr};\n`;
        } else {
          createStr += `${varName}.setAttribute(${JSON.stringify(k)}, String(${valExpr} ?? ''));\n`;
        }
        createStr += `itemRecord.elementMap[${JSON.stringify(varName)}] = ${varName};\n`;
        if (v.startsWith('{') && v.endsWith('}')) {
          if (isProp) {
            updateStr += `if (itemRecord.elementMap[${JSON.stringify(varName)}]) itemRecord.elementMap[${JSON.stringify(varName)}][${JSON.stringify(k)}] = ${valExpr};\n`;
          } else {
            updateStr += `if (itemRecord.elementMap[${JSON.stringify(varName)}]) itemRecord.elementMap[${JSON.stringify(varName)}].setAttribute(${JSON.stringify(k)}, String(${valExpr} ?? ''));\n`;
          }
        }
      }

      for (const [evtName, handlerStr] of Object.entries(elNode.events)) {
        const handlerExpr = evalExpr(handlerStr);
        createStr += `${varName}.addEventListener(${JSON.stringify(evtName)}, (e) => {\n`;
        createStr += `  regs[0] = e;\n`;
        createStr += `  const scope = (typeof itemRecord !== 'undefined' && itemRecord) ? itemRecord.scope : (typeof scope !== 'undefined' ? scope : {});\n`;
        createStr += `  const __h = (${handlerExpr});\n`;
        createStr += `  if (typeof __h === 'function') __h.call(vm, e);\n`;
        createStr += `});\n`;
      }

      for (let childIdx = 0; childIdx < elNode.children.length; childIdx++) {
        const child = elNode.children[childIdx]!;
        if (child.type === 'Element') {
          const childVar = `${varName}_c${childIdx}`;
          createStr += `let ${childVar};\n`;
          const sub = compileElementJS(child, childVar);
          createStr += sub.createStr;
          createStr += `${varName}.appendChild(${childVar});\n`;
          updateStr += sub.updateStr;
        } else if (child.type === 'Text') {
          createStr += `${varName}.appendChild(document.createTextNode(${JSON.stringify(child.content)}));\n`;
        } else if (child.type === 'Interpolation') {
          const valExpr = evalExpr(child.expression);
          const tVar = `${varName}_t${childIdx}`;
          createStr += `const ${tVar} = document.createTextNode(String(${valExpr} ?? ''));\n`;
          createStr += `${varName}.appendChild(${tVar});\n`;
          createStr += `itemRecord.textBindings['${varName}_${childIdx}'] = ${tVar};\n`;
          updateStr += `if (itemRecord.textBindings['${varName}_${childIdx}']) itemRecord.textBindings['${varName}_${childIdx}'].textContent = String(${valExpr} ?? '');\n`;
        }
      }

      return { createStr, updateStr };
    };

    for (let nodeIdx = 0; nodeIdx < nodes.length; nodeIdx++) {
      const node = nodes[nodeIdx]!;
      if (node.type === 'Element') {
        const varName = `el_${nodeIdx}`;
        createJS += `let ${varName};\n`;
        const res = compileElementJS(node, varName);
        createJS += res.createStr;
        updateJS += res.updateStr;
        createJS += `parent.insertBefore(${varName}, refNode);\nitemRecord.nodes.push(${varName});\n`;
      } else if (node.type === 'Text') {
        createJS += `const t_${nodeIdx} = document.createTextNode(${JSON.stringify(node.content)});\nparent.insertBefore(t_${nodeIdx}, refNode);\nitemRecord.nodes.push(t_${nodeIdx});\n`;
      } else if (node.type === 'Interpolation') {
        const valExpr = evalExpr(node.expression);
        createJS += `const t_${nodeIdx} = document.createTextNode(String(${valExpr} ?? ''));\nparent.insertBefore(t_${nodeIdx}, refNode);\nitemRecord.nodes.push(t_${nodeIdx});\nitemRecord.textBindings['root_${nodeIdx}'] = t_${nodeIdx};\n`;
        updateJS += `if (itemRecord.textBindings['root_${nodeIdx}']) itemRecord.textBindings['root_${nodeIdx}'].textContent = String(${valExpr} ?? '');\n`;
      }
    }

    return { createJS, updateJS };
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

  // 1. Extract dependency mask from iterable (e.g., `data`)
  const { rewritten: iterableRewritten, depMask: iterableMask } = this.analyzer.rewriteExpression(node.iterable, false);

  const extraLocals: string[] = [node.item];
  if (node.index) extraLocals.push(node.index);

  // 2. Scan loop body for additional external state dependencies (e.g., `selected`)
  let bodyMask = 0;
  const scanBodyDeps = (nodes: ASTNode[]) => {
    for (const n of nodes) {
      if (n.type === 'Element') {
        for (const v of Object.values(n.attributes)) {
          if (v.startsWith('{') && v.endsWith('}')) {
            const { depMask } = this.analyzer.rewriteExpression(v.slice(1, -1), false, extraLocals);
            bodyMask |= depMask;
          }
        }
        scanBodyDeps(n.children);
      } else if (n.type === 'Interpolation') {
        const { depMask } = this.analyzer.rewriteExpression(n.expression, false, extraLocals);
        bodyMask |= depMask;
      } else if (n.type === 'IfBlock') {
        const { depMask } = this.analyzer.rewriteExpression(n.condition, false, extraLocals);
        bodyMask |= depMask;
        scanBodyDeps(n.consequent);
        if (n.alternate) scanBodyDeps(n.alternate);
      }
    }
  };
  scanBodyDeps(node.body);

  const combinedDepMask = iterableMask | bodyMask;

  const keyRewritten = node.key ? this.analyzer.rewriteExpression(node.key, false, extraLocals).rewritten : null;
  const { createJS, updateJS } = this.compileForBodyToJS(node.body, node.item, node.index);

  const thunkCode = `
    const list = (${iterableRewritten}) || [];
    const itemVar = ${JSON.stringify(node.item)};
    const indexVar = ${JSON.stringify(node.index || null)};

    const getKey = (itemVal, indexVal, scope) => {
      const ${node.item} = itemVal;
      ${node.index ? `const ${node.index} = indexVal;` : ''}
      if (${keyRewritten ? 'true' : 'false'}) {
        return (${keyRewritten});
      } else if (itemVal !== null && typeof itemVal === 'object') {
        return itemVal.id !== undefined ? itemVal.id : (itemVal.key !== undefined ? itemVal.key : (itemVal._id !== undefined ? itemVal._id : indexVal));
      }
      return itemVal !== undefined ? itemVal : indexVal;
    };

    const createItem = (itemVal, indexVal, scope, parent, refNode) => {
      const ${node.item} = itemVal;
      ${node.index ? `const ${node.index} = indexVal;` : ''}
      const itemRecord = { key: null, nodes: [], textBindings: {}, elementMap: {}, scope, itemVal, indexVal };
      ${createJS}
      return itemRecord;
    };

    const updateItem = (itemRecord, itemVal, indexVal, scope) => {
      const ${node.item} = itemVal;
      ${node.index ? `const ${node.index} = indexVal;` : ''}
      ${updateJS}
    };

    if (vm && typeof vm.reconcileKeyedList === 'function') {
      vm.reconcileKeyedList(vm, ${anchorNodeIdx}, ${parentNodeIdx}, list, itemVar, indexVar, getKey, createItem, updateItem);
    }
  `;

  const thunkFn = this.analyzer.createThunk(thunkCode);
  const thunkIdx = this.getConstant(thunkFn);

  const arrReg = this.nextRegIdx++;
  this.emit(Opcodes.EXEC_THUNK, arrReg, thunkIdx, 0);

  // 3. Register update with combined dependency bitmask (iterable + body dependencies)
  this.updates.push({
    nodeIdx: anchorNodeIdx,
    reg: arrReg,
    thunkIdx,
    depMask: combinedDepMask,
    isForBlock: true
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
        const directMatch = /^regs\[(\d+)\]$/.exec(rewritten.trim());

        if (directMatch) {
          const directReg = parseInt(directMatch[1]!, 10);
          this.emit(setOpcode, nodeIdx, keyIdx, directReg);
          this.updates.push({ nodeIdx, reg: directReg, thunkIdx: 255, depMask, attrKeyIdx: keyIdx, isProperty });
        } else {
          const thunkFn = this.analyzer.createThunk(`return ${rewritten}`);
          const thunkIdx = this.getConstant(thunkFn);
          const reg = this.nextRegIdx++;
          
          this.emit(Opcodes.EXEC_THUNK, reg, thunkIdx);
          this.emit(setOpcode, nodeIdx, keyIdx, reg);
          this.updates.push({ nodeIdx, reg, thunkIdx, depMask, attrKeyIdx: keyIdx, isProperty });
        }
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
      this.emit24(Opcodes.CALL, 0);
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
    const directMatch = /^regs\[(\d+)\]$/.exec(rewritten.trim());

    if (directMatch) {
      const directReg = parseInt(directMatch[1]!, 10);
      this.emit(Opcodes.SET_TEXT, nodeIdx, directReg);
      this.updates.push({ nodeIdx, reg: directReg, thunkIdx: 255, depMask });
      return nodeIdx;
    }

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


