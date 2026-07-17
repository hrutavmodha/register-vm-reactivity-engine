export type ASTNode = ElementNode | TextNode | InterpolationNode | ScriptNode;

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
