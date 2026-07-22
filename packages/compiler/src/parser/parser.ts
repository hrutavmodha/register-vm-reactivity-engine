import type { ASTNode, ElementNode, TextNode, InterpolationNode, ScriptNode } from '../../types/index.js';
import { TokenType, type Token } from '../../types/index.js';
import { tokenize } from '../lexer/index.js';
import { VOID_ELEMENTS } from '../constants.js';


/**
 * DriftJS Parser for transforming token streams into AST node arrays.
 */
export class DriftJSParser {
  private tokens: Token[];
  private tokenCursor = 0;

  /**
   * Initializes a new parser instance.
   *
   * @param input - Either raw template source string or token array.
   */
  constructor(input: string | Token[]) {
    if (typeof input === 'string') {
      this.tokens = tokenize(input);
    } else {
      this.tokens = input;
    }
  }

  /**
   * Parses tokens into an array of AST nodes.
   *
   * @returns Array of parsed AST nodes.
   */
  public parse(): ASTNode[] {
    this.tokenCursor = 0;
    const nodes: ASTNode[] = [];

    while (!this.isEOF()) {
      const tok = this.currentToken();
      if (tok.type === TokenType.EOF) break;

      const node = this.parseNode();
      if (node) {
        if (node.type === 'Text' && node.content.trim() === '') {
          continue; // Strip whitespace-only formatting text nodes
        }
        nodes.push(node);
      }
    }
    return nodes;
  }

  private parseNode(): ASTNode | null {
    const tok = this.currentToken();

    if (tok.type === TokenType.If) {
      return this.parseIfBlock();
    }

    if (tok.type === TokenType.For) {
      return this.parseForBlock();
    }

    if (tok.type === TokenType.Interpolation) {
      this.tokenCursor++;
      return {
        type: 'Interpolation',
        expression: tok.value
      };
    }

    if (tok.type === TokenType.Text) {
      this.tokenCursor++;
      return {
        type: 'Text',
        content: tok.value
      };
    }

    if (tok.type === TokenType.TagOpen) {
      return this.parseElement();
    }

    if (tok.type === TokenType.TagClose || tok.type === TokenType.BlockClose || tok.type === TokenType.Else) {
      return null;
    }

    this.tokenCursor++;
    return null;
  }

  private parseIfBlock(): ASTNode {
    const ifTok = this.consumeToken(TokenType.If);
    const condition = ifTok.value;
    this.consumeToken(TokenType.BlockOpen);

    const consequent: ASTNode[] = [];
    while (
      !this.isEOF() &&
      this.currentToken().type !== TokenType.BlockClose &&
      this.currentToken().type !== TokenType.Else
    ) {
      const child = this.parseNode();
      if (child) {
        if (child.type === 'Text' && child.content.trim() === '') {
          continue;
        }
        consequent.push(child);
      }
    }

    if (this.currentToken().type === TokenType.BlockClose) {
      this.consumeToken(TokenType.BlockClose);
    }

    let alternate: ASTNode[] | undefined;
    if (this.currentToken().type === TokenType.Else) {
      this.consumeToken(TokenType.Else);
      if (this.currentToken().type === TokenType.BlockOpen) {
        this.consumeToken(TokenType.BlockOpen);
      }

      alternate = [];
      while (!this.isEOF() && this.currentToken().type !== TokenType.BlockClose) {
        const child = this.parseNode();
        if (child) {
          if (child.type === 'Text' && child.content.trim() === '') {
            continue;
          }
          alternate.push(child);
        }
      }

      if (this.currentToken().type === TokenType.BlockClose) {
        this.consumeToken(TokenType.BlockClose);
      }
    }

    return {
      type: 'IfBlock',
      condition,
      consequent,
      ...(alternate ? { alternate } : {})
    };
  }

  private parseForBlock(): ASTNode {
    const forTok = this.consumeToken(TokenType.For);
    const headerStr = forTok.value.trim();
    this.consumeToken(TokenType.BlockOpen);

    const inIdx = headerStr.indexOf(' in ');
    if (inIdx === -1) {
      throw new Error(`Invalid for loop syntax: expected "in" keyword in "${headerStr}"`);
    }

    let left = headerStr.substring(0, inIdx).trim();
    if (left.startsWith('(') && left.endsWith(')')) {
      left = left.slice(1, -1).trim();
    }
    const iterable = headerStr.substring(inIdx + 4).trim();

    let item = left;
    let index: string | undefined;
    if (left.includes(',')) {
      const parts = left.split(',').map(s => s.trim());
      item = parts[0] || 'item';
      index = parts[1];
    }

    const body: ASTNode[] = [];
    while (!this.isEOF() && this.currentToken().type !== TokenType.BlockClose) {
      const child = this.parseNode();
      if (child) {
        if (child.type === 'Text' && child.content.trim() === '') {
          continue;
        }
        body.push(child);
      }
    }

    if (this.currentToken().type === TokenType.BlockClose) {
      this.consumeToken(TokenType.BlockClose);
    }

    return {
      type: 'ForBlock',
      item,
      ...(index ? { index } : {}),
      iterable,
      body
    };
  }

  private parseElement(): ASTNode {
    const tagToken = this.consumeToken(TokenType.TagOpen);
    const tag = tagToken.value;
    const attributes: Record<string, string> = {};
    const events: Record<string, string> = {};

    if (tag.toLowerCase() === 'script') {
      // Script open tag
      if (this.currentToken().type === TokenType.TagOpenEnd) {
        this.tokenCursor++;
      }
      const scriptToken = this.consumeToken(TokenType.Script);
      if (this.currentToken().type === TokenType.TagClose) {
        this.tokenCursor++;
      }
      const scriptNode: ScriptNode = {
        type: 'Script',
        content: scriptToken.value
      };
      return scriptNode;
    }

    // Process attributes until TagOpenEnd or SelfClosingEnd
    while (
      !this.isEOF() &&
      this.currentToken().type !== TokenType.TagOpenEnd &&
      this.currentToken().type !== TokenType.SelfClosingEnd
    ) {
      const attrNameToken = this.consumeToken(TokenType.AttributeName);
      const attrName = attrNameToken.value;
      let attrValue = '';

      if (this.currentToken().type === TokenType.AttributeValue) {
        attrValue = this.currentToken().value;
        this.tokenCursor++;
      }

      if (attrName.startsWith('on') && attrName.length > 2) {
        const eventName = attrName.slice(2).toLowerCase();
        let handlerVal = attrValue;
        if (handlerVal.startsWith('{') && handlerVal.endsWith('}')) {
          handlerVal = handlerVal.slice(1, -1).trim();
        }
        events[eventName] = handlerVal;
      } else {
        attributes[attrName] = attrValue;
      }
    }

    const isSelfClosing = this.currentToken().type === TokenType.SelfClosingEnd;
    const isVoidTag = VOID_ELEMENTS.has(tag.toLowerCase());

    if (isSelfClosing) {
      this.tokenCursor++;
    } else if (this.currentToken().type === TokenType.TagOpenEnd) {
      this.tokenCursor++;
    }

    const children: ASTNode[] = [];
    if (!isSelfClosing && !isVoidTag) {
      while (
        !this.isEOF() &&
        this.currentToken().type !== TokenType.TagClose &&
        this.currentToken().type !== TokenType.BlockClose &&
        this.currentToken().type !== TokenType.Else
      ) {
        const child = this.parseNode();
        if (child) {
          if (child.type === 'Text' && child.content.trim() === '') {
            continue; // Strip whitespace-only formatting text nodes
          }
          children.push(child);
        }
      }

      if (this.currentToken().type === TokenType.TagClose) {
        const closingTagToken = this.consumeToken(TokenType.TagClose);
        if (closingTagToken.value.toLowerCase() !== tag.toLowerCase()) {
          throw new Error(`Expected closing tag </${tag}> but got </${closingTagToken.value}>`);
        }
      }
    }

    const elementNode: ElementNode = {
      type: 'Element',
      tag,
      attributes,
      events,
      children
    };
    return elementNode;
  }

  private currentToken(): Token {
    return this.tokens[this.tokenCursor] ?? {
      type: TokenType.EOF,
      value: '',
      start: 0,
      end: 0
    };
  }

  private consumeToken(expectedType: TokenType): Token {
    const tok = this.currentToken();
    if (tok.type !== expectedType) {
      throw new Error(`Expected token type ${expectedType} but got ${tok.type}`);
    }
    this.tokenCursor++;
    return tok;
  }

  private isEOF(): boolean {
    return this.tokenCursor >= this.tokens.length || this.currentToken().type === TokenType.EOF;
  }
}

/**
 * Convenience function to parse a template string into an AST node array.
 *
 * @param template - The template string to parse.
 * @returns Array of parsed AST nodes.
 */
export function parseTemplate(template: string): ASTNode[] {
  const parser = new DriftJSParser(template);
  return parser.parse();
}
