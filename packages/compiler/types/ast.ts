export type ASTNode = ElementNode | TextNode | InterpolationNode | ScriptNode | IfBlockNode | ForBlockNode;

export interface ForBlockNode {
  type: 'ForBlock';
  item: string;
  index?: string;
  iterable: string;
  body: ASTNode[];
}

export interface IfBlockNode {
  type: 'IfBlock';
  condition: string;
  consequent: ASTNode[];
  alternate?: ASTNode[];
}

export interface ScriptNode {
  type: 'Script';
  content: string;
}

export interface ElementNode {
  type: 'Element';
  tag: string;
  attributes: Record<string, string>;
  events: Record<string, string>;
  children: ASTNode[];
}

export interface TextNode {
  type: 'Text';
  content: string;
}

export interface InterpolationNode {
  type: 'Interpolation';
  expression: string;
}

