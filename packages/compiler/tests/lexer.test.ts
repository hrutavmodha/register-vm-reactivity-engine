import { describe, it, expect } from 'vitest';
import { DriftJSLexer, tokenize } from '../src/lexer/index.js';
import { TokenType } from '../types/index.js';

describe('DriftJSLexer', () => {
  describe('basic tokenization', () => {
    it('should tokenize simple HTML elements', () => {
      const tokens = tokenize('<div>Hello</div>');
      expect(tokens).toEqual([
        { type: TokenType.TagOpen, value: 'div', start: 0, end: 4 },
        { type: TokenType.TagOpenEnd, value: '>', start: 4, end: 5 },
        { type: TokenType.Text, value: 'Hello', start: 5, end: 10 },
        { type: TokenType.TagClose, value: 'div', start: 10, end: 16 },
        { type: TokenType.EOF, value: '', start: 16, end: 16 }
      ]);
    });

    it('should tokenize self-closing elements and attributes', () => {
      const tokens = tokenize('<img src="avatar.png" alt="Avatar" />');
      expect(tokens[0]).toEqual({ type: TokenType.TagOpen, value: 'img', start: 0, end: 4 });
      expect(tokens[1]).toEqual({ type: TokenType.AttributeName, value: 'src', start: 5, end: 8 });
      expect(tokens[2]).toEqual({ type: TokenType.AttributeValue, value: 'avatar.png', start: 9, end: 21 });
      expect(tokens[3]).toEqual({ type: TokenType.AttributeName, value: 'alt', start: 22, end: 25 });
      expect(tokens[4]).toEqual({ type: TokenType.AttributeValue, value: 'Avatar', start: 26, end: 34 });
      expect(tokens[5]).toEqual({ type: TokenType.SelfClosingEnd, value: '/>', start: 35, end: 37 });
    });

    it('should tokenize interpolations and nested braces', () => {
      const tokens = tokenize('<p>{items.map(x => ({ id: x.id }))}</p>');
      const interpToken = tokens.find(t => t.type === TokenType.Interpolation);
      expect(interpToken).toBeDefined();
      expect(interpToken?.value).toBe('items.map(x => ({ id: x.id }))');
    });

    it('should tokenize script blocks', () => {
      const source = '<script>let count = 0;</script>';
      const tokens = tokenize(source);
      expect(tokens).toEqual([
        { type: TokenType.TagOpen, value: 'script', start: 0, end: 7 },
        { type: TokenType.TagOpenEnd, value: '>', start: 7, end: 8 },
        { type: TokenType.Script, value: 'let count = 0;', start: 8, end: 22 },
        { type: TokenType.TagClose, value: 'script', start: 22, end: 31 },
        { type: TokenType.EOF, value: '', start: 31, end: 31 }
      ]);
    });
  });

  describe('edge and error cases', () => {
    it('should handle empty input', () => {
      const lexer = new DriftJSLexer('');
      const tokens = lexer.tokenize();
      expect(tokens).toEqual([{ type: TokenType.EOF, value: '', start: 0, end: 0 }]);
    });

    it('should throw error on unclosed script tag', () => {
      const lexer = new DriftJSLexer('<script>let x = 1;');
      expect(() => lexer.tokenize()).toThrow('Unclosed script tag');
    });

    it('should throw error on unclosed interpolation', () => {
      const lexer = new DriftJSLexer('<p>{count</p>');
      expect(() => lexer.tokenize()).toThrow('Unclosed interpolation expression');
    });

    it('should handle escaped quotes inside interpolation', () => {
      const tokens = tokenize('<p>{"Hello \\"World\\""}</p>');
      const interpToken = tokens.find(t => t.type === TokenType.Interpolation);
      expect(interpToken).toBeDefined();
      expect(interpToken?.value).toBe('"Hello \\"World\\""');
    });

    it('should tokenize multi-word hyphenated and namespaced attributes', () => {
      const tokens = tokenize('<div data-test-id="app" aria-label="Main" />');
      const attrTokens = tokens.filter(t => t.type === TokenType.AttributeName);
      expect(attrTokens.map(t => t.value)).toEqual(['data-test-id', 'aria-label']);
    });

    it('should handle boolean attributes without values', () => {
      const tokens = tokenize('<button disabled></button>');
      expect(tokens[0]).toEqual({ type: TokenType.TagOpen, value: 'button', start: 0, end: 7 });
      expect(tokens[1]).toEqual({ type: TokenType.AttributeName, value: 'disabled', start: 8, end: 16 });
      expect(tokens[2]).toEqual({ type: TokenType.TagOpenEnd, value: '>', start: 16, end: 17 });
    });

    it('should tokenize if and else control flow statements', () => {
      const source = 'if count > 5 { <p>High</p> } else { <p>Low</p> }';
      const tokens = tokenize(source);
      const ifTok = tokens.find(t => t.type === TokenType.If);
      const elseTok = tokens.find(t => t.type === TokenType.Else);
      expect(ifTok).toBeDefined();
      expect(ifTok?.value).toBe('count > 5');
      expect(elseTok).toBeDefined();
      expect(elseTok?.value).toBe('else');
    });

    it('should tokenize for loop control flow blocks', () => {
      const source = '<div>for item, index in items { <p>{item}</p> }</div>';
      const lexer = new DriftJSLexer(source);
      const tokens = lexer.tokenize();

      const forTok = tokens.find(t => t.type === TokenType.For);
      expect(forTok).toBeDefined();
      expect(forTok?.value).toBe('item, index in items');
    });
  });
});
