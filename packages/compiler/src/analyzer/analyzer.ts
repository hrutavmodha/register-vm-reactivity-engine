import type { ASTNode, ScriptNode, AnalyzedExpression, AnalysisResult, Replacement } from '../../types/index.js';
import * as acorn from 'acorn';
import { walk } from 'estree-walker';

const JS_GLOBALS = new Set([
  'console', 'window', 'document', 'globalThis', 'Math', 'Date', 'Array', 'Object',
  'String', 'Number', 'Boolean', 'JSON', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Promise', 'Error', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI',
  'encodeURIComponent', 'decodeURI', 'decodeURIComponent', 'event', 'undefined',
  'null', 'true', 'false', 'this', 'NaN', 'Infinity', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval'
]);

/**
 * DriftJS Analyzer for performing AST scope resolution, reactive variable tracking,
 * dependency mask calculation, and AST expression transformations.
 */
export class DriftJSAnalyzer {
  public varToReg: Map<string, number> = new Map();
  public nextRegIdx = 1;

  /**
   * Initializes a new analyzer instance.
   *
   * @param ast - The AST node array to analyze.
   */
  constructor(private readonly ast: ASTNode[]) {}

  /**
   * Performs semantic analysis on the AST.
   *
   * @returns Complete analysis result including var-to-register map and analyzed script thunk codes.
   */
  public analyze(): AnalysisResult {
    this.varToReg = new Map();
    this.nextRegIdx = 1;

    const scriptNodes = this.collectScriptNodes(this.ast);
    const scriptThunkCodes: string[] = [];

    for (const script of scriptNodes) {
      scriptThunkCodes.push(this.analyzeScript(script));
    }

    return {
      varToReg: this.varToReg,
      nextRegIdx: this.nextRegIdx,
      scriptThunkCodes
    };
  }

  private collectScriptNodes(nodes: ASTNode[]): ScriptNode[] {
    const scripts: ScriptNode[] = [];
    for (const node of nodes) {
      if (node.type === 'Script') {
        scripts.push(node);
      } else if (node.type === 'Element' && node.children) {
        scripts.push(...this.collectScriptNodes(node.children));
      } else if (node.type === 'IfBlock') {
        scripts.push(...this.collectScriptNodes(node.consequent));
        if (node.alternate) {
          scripts.push(...this.collectScriptNodes(node.alternate));
        }
      } else if (node.type === 'ForBlock') {
        scripts.push(...this.collectScriptNodes(node.body));
      }
    }
    return scripts;
  }

  public getRegForVar(name: string): number {
    return this.varToReg.get(name)!;
  }

  public hasVar(name: string): boolean {
    return this.varToReg.has(name);
  }

  public createThunk(code: string): (regs: unknown[], vm: unknown) => unknown {
    return new Function('regs', 'vm', code) as (regs: unknown[], vm: unknown) => unknown;
  }

  /**
   * Rewrites an expression, calculating dependency masks and inserting reactive dirty marks.
   *
   * @param expr - Expression string to rewrite.
   * @param isEventHandler - Whether the expression is inside an event handler.
   * @param localScopeVars - Optional array of additional local variable names in scope.
   * @returns Analyzed expression with rewritten string and depMask.
   */
  public rewriteExpression(expr: string, isEventHandler = false, localScopeVars: string[] = []): AnalyzedExpression {
    const jsAst = acorn.parse(expr, { ecmaVersion: 2020, allowReturnOutsideFunction: true });
    const replacements: Replacement[] = [];
    let depMask = 0;

    const localScopes: Set<string>[] = [new Set()];
    if (isEventHandler) {
      localScopes[0]!.add('e');
      localScopes[0]!.add('event');
    }
    for (const v of localScopeVars) {
      if (v) localScopes[0]!.add(v);
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

  private analyzeScript(scriptNode: ScriptNode): string {
    const jsAst = acorn.parse(scriptNode.content, { ecmaVersion: 2020 });

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

    const replacements: Replacement[] = [];
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
    return rewritten;
  }
}

/**
 * Convenience function to analyze an AST node array.
 *
 * @param ast - The AST array to analyze.
 * @returns Analysis result.
 */
export function analyzeAST(ast: ASTNode[]): AnalysisResult {
  const analyzer = new DriftJSAnalyzer(ast);
  return analyzer.analyze();
}
