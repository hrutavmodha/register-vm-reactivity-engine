import type { Opcode } from '../types/index.js';

export const Opcodes = {
  LOAD_CONST: 1,
  LOAD_NODE: 2,
  EXEC_THUNK: 3,
  CREATE_ELEMENT: 4,
  CREATE_TEXT: 5,
  APPEND_CHILD: 6,
  MOUNT: 7,
  SET_TEXT: 8,
  SET_ATTRIBUTE: 9,
  BIND_EVENT: 10,
  JUMP: 11,
  JUMP_IF_TRUE: 12,
  RETURN: 13,
  CALL: 14,
  REMOVE_CHILD: 15,
  SET_PROPERTY: 16,
  CREATE_COMMENT: 17,
  INSERT_BEFORE: 18,
  JUMP_IF_FALSE: 19,
  JUMP_IF_EQUAL: 20,
} as const;


/**
 * Encodes an instruction with up to three 8-bit arguments.
 */
export function encodeInstruction(op: Opcode, a: number = 0, b: number = 0, c: number = 0): number {
  return ((op & 0xFF) << 24) | ((a & 0xFF) << 16) | ((b & 0xFF) << 8) | (c & 0xFF);
}

export function encodeJump(op: Opcode, offset: number): number {
  return ((op & 0xFF) << 24) | (offset & 0xFFFFFF);
}

/**
 * Encodes an instruction with a single 24-bit argument.
 */
export function encodeInstruction24(op: Opcode, arg24: number): number {
  return ((op & 0xFF) << 24) | (arg24 & 0xFFFFFF);
}
