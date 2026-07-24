export interface ItemRecord {
  key: unknown;
  nodes: Node[];
  textBindings: Record<string, Text>;
  elementMap: Record<string, HTMLElement>;
  scope: Record<string, unknown>;
  itemVal?: unknown;
  indexVal?: number;
}

function getSequence(arr: Int32Array): number[] {
  const p = new Int32Array(arr.length);
  const result: number[] = [];
  let u: number, v: number, c: number;
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    const arrI = arr[i]!;
    if (arrI !== -1) {
      const lastIdx = result[result.length - 1]!;
      if (result.length === 0 || arr[lastIdx]! < arrI) {
        p[i] = result.length > 0 ? lastIdx : -1;
        result.push(i);
        continue;
      }
      u = 0;
      v = result.length - 1;
      while (u < v) {
        c = (u + v) >> 1;
        if (arr[result[c]!]! < arrI) {
          u = c + 1;
        } else {
          v = c;
        }
      }
      if (arrI < arr[result[u]!]!) {
        if (u > 0) {
          p[i] = result[u - 1]!;
        }
        result[u] = i;
      }
    }
  }
  let uLen = result.length;
  if (uLen === 0) return [];
  let vIdx = result[uLen - 1]!;
  while (uLen-- > 0) {
    result[uLen] = vIdx;
    vIdx = p[vIdx]!;
  }
  return result;
}

/**
 * Executes keyed list LIS reconciliation over a dynamic array against DOM nodes.
 * Used by compiled for-blocks to efficiently patch, insert, delete, and reorder list items.
 */
export function reconcileKeyedList(
  vm: any,
  anchorNodeIdx: number,
  parentNodeIdx: number,
  list: unknown[],
  itemVar: string,
  indexVar: string | null,
  getKey: (itemVal: unknown, indexVal: number, scope: Record<string, unknown>) => unknown,
  createItem: (itemVal: unknown, indexVal: number, scope: Record<string, unknown>, parent: Node, refNode: Node) => ItemRecord,
  updateItem: (itemRecord: ItemRecord, itemVal: unknown, indexVal: number, scope: Record<string, unknown>) => void
): void {
  const _nodes = (vm && vm.nodes) || null;
  const parent = (_nodes && _nodes[parentNodeIdx]) || (vm && vm.rootElement) || (typeof document !== 'undefined' ? document.body : null);
  const anchor = _nodes && _nodes[anchorNodeIdx];
  if (!parent || !anchor) return;
  if (anchor.parentNode !== parent) {
    parent.appendChild(anchor);
  }

  if (!vm._forCache) vm._forCache = new Map<number, ItemRecord[]>();
  const oldCache: ItemRecord[] = vm._forCache.get(anchorNodeIdx) || [];
  const newCache: ItemRecord[] = [];
  const newKeySet = new Set<unknown>();

  const safeList = Array.isArray(list) ? list : [];

  for (let i = 0; i < safeList.length; i++) {
    const itemVal = safeList[i];
    const indexVal = i;
    const scope: Record<string, unknown> = { [itemVar]: itemVal };
    if (indexVar) scope[indexVar] = indexVal;

    const rawKeyVal = getKey(itemVal, indexVal, scope);
    let keyVal = rawKeyVal;
    let dupIdx = 0;
    while (newKeySet.has(keyVal)) {
      dupIdx++;
      keyVal = String(rawKeyVal) + '__dup_' + dupIdx;
    }
    newKeySet.add(keyVal);
    newCache.push({ key: keyVal, nodes: [], textBindings: {}, elementMap: {}, scope, itemVal, indexVal });
  }

  const oldLen = oldCache.length;
  const newLen = newCache.length;
  let i = 0;
  let oldEnd = oldLen - 1;
  let newEnd = newLen - 1;

  // 1. Sync prefix
  while (i <= oldEnd && i <= newEnd && oldCache[i]!.key === newCache[i]!.key) {
    const oldRec = oldCache[i]!;
    const newItem = newCache[i]!;
    oldRec.scope = newItem.scope;
    updateItem(oldRec, newItem.itemVal, newItem.indexVal!, newItem.scope);
    newCache[i] = oldRec;
    i++;
  }

  // 2. Sync suffix
  while (i <= oldEnd && i <= newEnd && oldCache[oldEnd]!.key === newCache[newEnd]!.key) {
    const oldRec = oldCache[oldEnd]!;
    const newItem = newCache[newEnd]!;
    oldRec.scope = newItem.scope;
    updateItem(oldRec, newItem.itemVal, newItem.indexVal!, newItem.scope);
    newCache[newEnd] = oldRec;
    oldEnd--;
    newEnd--;
  }

  // 3. Pure additions
  if (i > oldEnd) {
    if (i <= newEnd) {
      const refNode = (newEnd + 1 < newLen) ? newCache[newEnd + 1]!.nodes[0]! : anchor;
      for (let k = i; k <= newEnd; k++) {
        const newItem = newCache[k]!;
        const itemRecord = createItem(newItem.itemVal, newItem.indexVal!, newItem.scope, parent, refNode);
        itemRecord.key = newItem.key;
        newCache[k] = itemRecord;
      }
    }
  }
  // 4. Pure deletions
  else if (i > newEnd) {
    for (let k = i; k <= oldEnd; k++) {
      const oldRec = oldCache[k]!;
      for (let nIdx = 0; nIdx < oldRec.nodes.length; nIdx++) {
        const n = oldRec.nodes[nIdx];
        if (n && n.parentNode) {
          n.parentNode.removeChild(n);
        }
      }
    }
  }
  // 5. Complex keyed reconciliation with LIS
  else {
    const s1 = i;
    const e1 = newEnd;
    const s2 = i;
    const e2 = oldEnd;

    const keyToNewIndexMap = new Map<unknown, number>();
    for (let k = s1; k <= e1; k++) {
      keyToNewIndexMap.set(newCache[k]!.key, k);
    }

    const unhandledNewCount = e1 - s1 + 1;
    const sources = new Int32Array(unhandledNewCount);
    sources.fill(-1);

    let patched = 0;
    let moved = false;
    let maxIndexSoFar = 0;

    for (let k = s2; k <= e2; k++) {
      const oldRec = oldCache[k]!;
      const newIndex = keyToNewIndexMap.get(oldRec.key);
      if (newIndex === undefined) {
        for (let nIdx = 0; nIdx < oldRec.nodes.length; nIdx++) {
          const n = oldRec.nodes[nIdx];
          if (n && n.parentNode) {
            n.parentNode.removeChild(n);
          }
        }
      } else {
        const newIndexInSources = newIndex - s1;
        sources[newIndexInSources] = k;
        if (newIndex >= maxIndexSoFar) {
          maxIndexSoFar = newIndex;
        } else {
          moved = true;
        }
        const newItem = newCache[newIndex]!;
        oldRec.scope = newItem.scope;
        updateItem(oldRec, newItem.itemVal, newItem.indexVal!, newItem.scope);
        newCache[newIndex] = oldRec;
        patched++;
      }
    }

    const lis = moved ? getSequence(sources) : [];
    let lisIdx = lis.length - 1;

    for (let j = unhandledNewCount - 1; j >= 0; j--) {
      const newIndex = s1 + j;
      const newItem = newCache[newIndex]!;
      const refNode = (newIndex + 1 < newLen) ? newCache[newIndex + 1]!.nodes[0]! : anchor;

      if (sources[j] === -1) {
        const itemRecord = createItem(newItem.itemVal, newItem.indexVal!, newItem.scope, parent, refNode);
        itemRecord.key = newItem.key;
        newCache[newIndex] = itemRecord;
      } else if (moved) {
        if (lisIdx < 0 || j !== lis[lisIdx]) {
          const itemRecord = newCache[newIndex]!;
          for (let nIdx = 0; nIdx < itemRecord.nodes.length; nIdx++) {
            const n = itemRecord.nodes[nIdx];
            if (n) parent.insertBefore(n, refNode);
          }
        } else {
          lisIdx--;
        }
      }
    }
  }

  vm._forCache.set(anchorNodeIdx, newCache);
}
