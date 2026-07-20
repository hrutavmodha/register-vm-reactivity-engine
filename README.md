# DriftJS ⚡

> **A Register VM-Based Reactivity Engine & AOT Compiler for High-Performance UI**

DriftJS replaces traditional JavaScript-object-level reactivity (such as Virtual DOM diffing, proxy trees, or heavy signal graph allocations) with an **Ahead-Of-Time (AOT) Bytecode Compiler** and a lightweight **Register Virtual Machine (VM)** runtime interpreter.

---

## 🌟 Key Architectural Features

- **Bytecode & Register VM Architecture**: Replaces VDOM diffing and proxy overhead with a linear 32-bit instruction stream running on a low-latency fetch-decode-execute loop.
- **$O(1)$ Direct DOM Patching**: State updates mutate register slots directly. Guarded thunk execution (`EXEC_THUNK_GUARDED`) skips unneeded DOM updates using bitfield dependency masks (`dirtyMask`).
- **Single-File Component (`.drift`) Support**: Author components in single `.drift` files combining `<script>` logic and template markup.
- **Build-Time AOT Compiler (`vite-plugin-drift`)**: Compiles `.drift` templates into binary `Uint32Array` bytecode streams at build time in Vite/Rollup—shipping zero parser overhead to the client browser.
- **Cross-Platform Potential**: Because templates compile down to raw 32-bit instruction streams, the VM can be re-implemented natively in Kotlin (Android) or Swift (iOS) to drive native mobile UI views with zero bridge serialization overhead.

---

## 🚀 Quick Start

### 1. Installation

```bash
npm install driftjs
npm install -D vite-plugin-drift
```

### 2. Configure Vite (`vite.config.ts`)

```typescript
import { defineConfig } from 'vite';
import { driftPlugin } from 'vite-plugin-drift';

export default defineConfig({
  plugins: [driftPlugin()]
});
```

### 3. Create a Component (`App.drift`)

```html
<script>
  let userInput = "Hello DriftJS!";

  function handleInput(e) {
    userInput = e.target.value;
  }
</script>

<div id="container" class="my-app">
  <h1>{userInput}</h1>
  <input type="text" value={userInput} oninput={(e) => handleInput(e);} />
</div>
```

### 4. Mount the Component (`main.ts`)

```typescript
import { mount } from 'driftjs';
import App from './App.drift';

const appElement = document.getElementById('app')!;
mount(App, appElement);
```

---

## 📦 Packages in this Monorepo

| Package | Version | Description |
| :--- | :--- | :--- |
| **`driftjs`** | `0.0.0` | Core reactivity engine containing Parser, AST Compiler, and Register VM |
| **`vite-plugin-drift`** | `0.0.0` | Vite plugin for compiling `.drift` templates to VM bytecode AOT |

---

## ⚙️ How It Works Under The Hood

```
[ .drift Template ] 
       │
       ▼ (AOT Build Step: vite-plugin-drift)
[ DriftJSParser ] ──> [ AST Node Tree ] ──> [ DriftJSCompiler ]
                                                   │
                                                   ▼
                                 [ 32-bit Uint32Array Bytecode + Constants ]
                                                   │
                                                   ▼ (Runtime Execution)
                                            [ DriftJSVM ] ──> Direct DOM Patches
```

### VM Instruction Set (ISA)

Instructions are encoded into fixed-width 32-bit words:
`[ Opcode (8-bit) | Register A / Node (8-bit) | Register B / Constant (8-bit) | Register C / Offset (8-bit) ]`

For the complete 16-opcode instruction set specification, hex encodings, and operand layouts, see the [DriftJS ISA Specification](docs/ISA.md).

---

## 🛠️ Monorepo Development

```bash
# Install dependencies
pnpm install

# Type-check workspace
pnpm lint

# Build all packages into dist/
pnpm build

# Run unit test suite
pnpm test
```

---

## 📄 Theoretical & Architectural References

The design of DriftJS draws from foundational research in register-based virtual machines and AOT reactive UI compilation:
- **Register VM Architecture**: Inspired by *The Implementation of Lua 5.0* (Ierusalimschy et al., 2005) for linear instruction dispatch and reduced stack manipulation overhead compared to stack-based VMs.
- **Interpreters & ISA Design**: Based on principles from *Crafting Interpreters* (Nystrom, R., 2021) and *Engineering a Compiler* (Cooper & Torczon, 2011).
- **Compile-Time Reactive Dependency Tracking**: Inspired by the AOT compilation model of *Svelte* and the fine-grained reactivity guarantees of *SolidJS*.

---

## 📜 License

MIT © Hrutav Modha
