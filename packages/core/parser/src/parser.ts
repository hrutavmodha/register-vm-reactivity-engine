import type { ASTNode, ElementNode, TextNode, InterpolationNode } from './ast.js';

export class Parser {
  private cursor = 0;
  
  constructor(private readonly source: string) {}

  public parse(): ASTNode[] {
    const nodes: ASTNode[] = [];
    while (!this.isEOF()) {
      const node = this.parseNode();
      if (node) {
        nodes.push(node);
      }
    }
    return nodes;
  }

  private parseNode(): ASTNode | null {
    if (this.match('{')) {
      return this.parseInterpolation();
    }
    
    if (this.match('<')) {
      if (this.source[this.cursor] === '/') {
        // Closing tag, should be handled by parseElement
        return null;
      }
      return this.parseElement();
    }

    return this.parseText();
  }

  private parseElement(): ASTNode {
    // Expecting to be right after '<'
    const tag = this.parseTagName();
    const attributes: Record<string, string> = {};
    const events: Record<string, string> = {};

    this.consumeWhitespace();

    while (!this.isEOF() && !this.startsWith('>') && !this.startsWith('/>')) {
      const attrName = this.parseAttributeName();
      this.consumeWhitespace();
      
      let attrValue = '';
      if (this.match('=')) {
        this.consumeWhitespace();
        attrValue = this.parseAttributeValue();
      }

      if (attrName.startsWith('on') && attrName.length > 2) {
        // e.g. "onclick" -> "click"
        const eventName = attrName.slice(2).toLowerCase();
        events[eventName] = attrValue;
      } else {
        attributes[attrName] = attrValue;
      }

      this.consumeWhitespace();
    }

    const isSelfClosing = this.match('/>');
    if (!isSelfClosing && !this.match('>')) {
      // It should have matched '>' above
      this.consume('>');
    }

    if (tag === 'script') {
      const endScriptIdx = this.source.indexOf('</script>', this.cursor);
      if (endScriptIdx === -1) {
        throw new Error('Unclosed script tag');
      }
      const content = this.source.slice(this.cursor, endScriptIdx);
      this.cursor = endScriptIdx;
      this.consume('</script>');
      return { type: 'Script', content: content.trim() } as any;
    }

    const children: ASTNode[] = [];
    if (!isSelfClosing) {
      while (!this.isEOF() && !this.startsWith('</')) {
        const child = this.parseNode();
        if (child) children.push(child);
      }
      this.consume('</');
      const closingTag = this.parseTagName();
      if (closingTag !== tag) {
        throw new Error(`Expected closing tag </${tag}> but got </${closingTag}>`);
      }
      this.consumeWhitespace();
      this.consume('>');
    }

    return {
      type: 'Element',
      tag,
      attributes,
      events,
      children
    };
  }

  private parseText(): TextNode {
    let content = '';
    while (!this.isEOF() && !this.startsWith('<') && !this.startsWith('{')) {
      content += this.source[this.cursor++];
    }
    return { type: 'Text', content };
  }

  private parseInterpolation(): InterpolationNode {
    let expression = '';
    while (!this.isEOF() && !this.startsWith('}')) {
      expression += this.source[this.cursor++];
    }
    this.consume('}');
    return { type: 'Interpolation', expression: expression.trim() };
  }

  private parseTagName(): string {
    let name = '';
    while (!this.isEOF() && /[a-zA-Z0-9\-]/.test(this.source[this.cursor]!)) {
      name += this.source[this.cursor++];
    }
    if (!name) throw new Error('Expected tag name');
    return name;
  }

  private parseAttributeName(): string {
    let name = '';
    while (!this.isEOF() && /[a-zA-Z0-9\-:@]/.test(this.source[this.cursor]!)) {
      name += this.source[this.cursor++];
    }
    return name;
  }

  private parseAttributeValue(): string {
    const quote = this.source[this.cursor];
    if (quote === '"' || quote === "'") {
      this.cursor++;
      let value = '';
      while (!this.isEOF() && this.source[this.cursor] !== quote) {
        value += this.source[this.cursor++];
      }
      this.cursor++; // consume closing quote
      return value;
    }
    
    // Unquoted value
    let value = '';
    while (!this.isEOF() && !/[\s>]/.test(this.source[this.cursor]!)) {
      value += this.source[this.cursor++];
    }
    return value;
  }

  private consumeWhitespace() {
    while (!this.isEOF() && /\s/.test(this.source[this.cursor]!)) {
      this.cursor++;
    }
  }

  private match(str: string): boolean {
    if (this.startsWith(str)) {
      this.cursor += str.length;
      return true;
    }
    return false;
  }

  private consume(str: string) {
    if (!this.match(str)) {
      throw new Error(`Expected "${str}" at index ${this.cursor}`);
    }
  }

  private startsWith(str: string): boolean {
    return this.source.startsWith(str, this.cursor);
  }

  private isEOF(): boolean {
    return this.cursor >= this.source.length;
  }
}

export function parseTemplate(template: string): ASTNode[] {
  const parser = new Parser(template);
  return parser.parse();
}
