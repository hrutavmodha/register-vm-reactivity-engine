import { describe, it, expect } from 'vitest';
import { DriftJSParser, parseTemplate } from '../src/parser/index.js';

describe('DriftJSParser', () => {
  describe('constructor input data passing', () => {
    it('should parse template passed to constructor', () => {
      const parser = new DriftJSParser('<div>Hello</div>');
      const ast = parser.parse();
      expect(ast).toEqual([
        {
          type: 'Element',
          tag: 'div',
          attributes: {},
          events: {},
          children: [
            {
              type: 'Text',
              content: 'Hello'
            }
          ]
        }
      ]);
    });

    it('should parse template via parseTemplate convenience function', () => {
      const ast = parseTemplate('<p>{count}</p>');
      expect(ast).toEqual([
        {
          type: 'Element',
          tag: 'p',
          attributes: {},
          events: {},
          children: [
            {
              type: 'Interpolation',
              expression: 'count'
            }
          ]
        }
      ]);
    });

    it('should parse expression attributes and arrow function event handlers', () => {
      const template = '<input type="text" value={userInput} oninput={(e) => handleInput(e);} />';
      const ast = parseTemplate(template);
      expect(ast).toEqual([
        {
          type: 'Element',
          tag: 'input',
          attributes: {
            type: 'text',
            value: '{userInput}'
          },
          events: {
            input: '(e) => handleInput(e);'
          },
          children: []
        }
      ]);
    });
  });

  describe('HTML void elements and nested braces', () => {
    it('should correctly parse void elements without expecting closing tags', () => {
      const template = '<div><img src="avatar.png"><br><input type="checkbox"></div>';
      const ast = parseTemplate(template);
      expect(ast).toEqual([
        {
          type: 'Element',
          tag: 'div',
          attributes: {},
          events: {},
          children: [
            { type: 'Element', tag: 'img', attributes: { src: 'avatar.png' }, events: {}, children: [] },
            { type: 'Element', tag: 'br', attributes: {}, events: {}, children: [] },
            { type: 'Element', tag: 'input', attributes: { type: 'checkbox' }, events: {}, children: [] }
          ]
        }
      ]);
    });

    it('should parse interpolations with nested braces and arrow functions', () => {
      const template = '<p>{items.map(x => ({ id: x.id }))}</p>';
      const ast = parseTemplate(template);
      expect(ast).toEqual([
        {
          type: 'Element',
          tag: 'p',
          attributes: {},
          events: {},
          children: [
            {
              type: 'Interpolation',
              expression: 'items.map(x => ({ id: x.id }))'
            }
          ]
        }
      ]);
    });

    it('should strip whitespace-only formatting text nodes between elements', () => {
      const template = `
        <div>
          <h1>Title</h1>
        </div>
      `;
      const ast = parseTemplate(template);
      expect(ast).toEqual([
        {
          type: 'Element',
          tag: 'div',
          attributes: {},
          events: {},
          children: [
            {
              type: 'Element',
              tag: 'h1',
              attributes: {},
              events: {},
              children: [{ type: 'Text', content: 'Title' }]
            }
          ]
        }
      ]);
    });

    it('should parse control flow if and else statements', () => {
      const template = '<div>if count > 5 { <p>High</p> } else { <p>Low</p> }</div>';
      const ast = parseTemplate(template);
      expect(ast).toEqual([
        {
          type: 'Element',
          tag: 'div',
          attributes: {},
          events: {},
          children: [
            {
              type: 'IfBlock',
              condition: 'count > 5',
              consequent: [
                {
                  type: 'Element',
                  tag: 'p',
                  attributes: {},
                  events: {},
                  children: [{ type: 'Text', content: 'High' }]
                }
              ],
              alternate: [
                {
                  type: 'Element',
                  tag: 'p',
                  attributes: {},
                  events: {},
                  children: [{ type: 'Text', content: 'Low' }]
                }
              ]
            }
          ]
        }
      ]);
    });

    it('should parse for loop control flow blocks', () => {
      const template = '<div>for item, idx in items { <p>{item}</p> }</div>';
      const ast = parseTemplate(template);

      expect(ast).toEqual([
        {
          type: 'Element',
          tag: 'div',
          attributes: {},
          events: {},
          children: [
            {
              type: 'ForBlock',
              item: 'item',
              index: 'idx',
              iterable: 'items',
              body: [
                {
                  type: 'Element',
                  tag: 'p',
                  attributes: {},
                  events: {},
                  children: [{ type: 'Interpolation', expression: 'item' }]
                }
              ]
            }
          ]
        }
      ]);
    });
  });

  describe('edge and error cases', () => {
    it('should handle empty input', () => {
      const parser = new DriftJSParser('');
      const ast = parser.parse();
      expect(ast).toEqual([]);
    });

    it('should throw Error when tag name is missing', () => {
      expect(() => parseTemplate('<>')).toThrow('Expected tag name');
    });

    it('should throw Error when closing tag mismatches', () => {
      expect(() => parseTemplate('<div></span>')).toThrow('Expected closing tag </div> but got </span>');
    });

    it('should throw Error when interpolation is unclosed', () => {
      expect(() => parseTemplate('<p>{count</p>')).toThrow('Unclosed interpolation');
    });

    it('should parse boolean attributes without explicit values', () => {
      const ast = parseTemplate('<button disabled>Submit</button>');
      expect(ast).toEqual([
        {
          type: 'Element',
          tag: 'button',
          attributes: { disabled: '' },
          events: {},
          children: [{ type: 'Text', content: 'Submit' }]
        }
      ]);
    });

    it('should parse self-closing custom elements', () => {
      const ast = parseTemplate('<my-card title="Info" />');
      expect(ast).toEqual([
        {
          type: 'Element',
          tag: 'my-card',
          attributes: { title: 'Info' },
          events: {},
          children: []
        }
      ]);
    });

    it('should parse deeply nested element trees', () => {
      let template = 'Hello';
      for (let i = 0; i < 50; i++) {
        template = `<div>${template}</div>`;
      }
      const ast = parseTemplate(template);
      let curr = ast[0];
      for (let i = 0; i < 49; i++) {
        expect(curr?.type).toBe('Element');
        curr = (curr as any).children[0];
      }
      expect(curr?.type).toBe('Element');
      expect((curr as any).children[0]).toEqual({ type: 'Text', content: 'Hello' });
    });
  });
});
