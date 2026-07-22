# DriftJS ISA Specification

| Value | Hex | Mnemonic | Description |
| :---: | :---: | :--- | :--- |
| **1** | `0x01` | `LOAD_CONST` | Loads constant value `constants[c_b]` into register `registers[r_a]`. |
| **2** | `0x02` | `LOAD_NODE` | Loads DOM node reference `nodes[n_b]` into register `registers[r_a]`. |
| **3** | `0x03` | `EXEC_THUNK` | Executes JS thunk `constants[c_b](registers)`, stores output in `registers[r_a]`, and updates `dirtyMask`. Skips execution if `depMask_c` is set and `(dirtyMask & depMask_c) === 0`. |
| **4** | `0x04` | `CREATE_ELEMENT` | Creates HTML element `document.createElement(constants[c_a])` at `nodes[n_b]`. |
| **5** | `0x05` | `CREATE_TEXT` | Creates text node `document.createTextNode(constants[c_a])` at `nodes[n_b]`. |
| **6** | `0x06` | `APPEND_CHILD` | Appends child node `nodes[n_b]` to parent `nodes[n_a]`. |
| **7** | `0x07` | `MOUNT` | Appends root node `nodes[n_a]` to root element container. |
| **8** | `0x08` | `SET_TEXT` | Updates text node `nodes[n_a].nodeValue` to `registers[r_b]`. Performs DOM patch only if value changed. |
| **9** | `0x09` | `SET_ATTRIBUTE` | Sets attribute `constants[c_b]` on element `nodes[n_a]` to `registers[r_c]`. |
| **10** | `0x0A` | `BIND_EVENT` | Registers global delegated event listener `constants[c_b]` for node `n_a` jumping to `offset_c`. |
| **11** | `0x0B` | `JUMP` | Unconditional branch to target offset `pc = offset24`. |
| **12** | `0x0C` | `JUMP_IF_TRUE` | Conditional branch to target offset if `registers[r_a]` is truthy (`true`). |
| **13** | `0x0D` | `RETURN` | Resets event register `registers[0]`, resets `dirtyMask`, and returns from function execution loop. |
| **14** | `0x0E` | `CALL` | Subroutine call: pushes current `pc` onto `callStack` and jumps to target offset `pc = offset24`. |
| **15** | `0x0F` | `REMOVE_CHILD` | Removes child node `nodes[n_b]` from parent `nodes[n_a]` (`parent.removeChild(child)`). |
| **16** | `0x10` | `SET_PROPERTY` | Sets DOM property `constants[c_b]` on element `nodes[n_a]` directly (`element[prop] = val`). |
| **17** | `0x11` | `CREATE_COMMENT` | Creates DOM comment node `document.createComment(constants[c_a])` at `nodes[n_b]`. |
| **18** | `0x12` | `INSERT_BEFORE` | Inserts `nodes[n_b]` into parent `nodes[n_a]` before anchor node `nodes[n_c]`. |
| **19** | `0x13` | `JUMP_IF_FALSE` | Conditional branch to target offset if `registers[r_a]` is falsy. |
| **20** | `0x14` | `JUMP_IF_EQUAL` | Conditional branch to target offset if `registers[r_a] === registers[r_b]`. |

