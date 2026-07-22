export enum TokenType {
  TagOpen = 'TagOpen',
  TagOpenEnd = 'TagOpenEnd',
  SelfClosingEnd = 'SelfClosingEnd',
  TagClose = 'TagClose',
  AttributeName = 'AttributeName',
  AttributeValue = 'AttributeValue',
  Text = 'Text',
  Interpolation = 'Interpolation',
  Script = 'Script',
  If = 'If',
  Else = 'Else',
  For = 'For',
  BlockOpen = 'BlockOpen',
  BlockClose = 'BlockClose',
  EOF = 'EOF'
}

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}
