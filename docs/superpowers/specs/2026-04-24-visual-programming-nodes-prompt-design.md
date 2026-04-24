# BluePrint-ai — Visual Programming Nodes & Prompt Engine

**Date:** 2026-04-24
**Approach:** B — Node Type Registry

---

## Goal

Transform BluePrint-ai into a visual conceptual programming tool: users build flowchart-like diagrams representing logic and architecture, then generate a detailed Claude Code implementation plan — whether starting from scratch, adding a feature, or modifying existing code.

---

## 1. Node Type Registry

Replace the current `NT` constant with a `NODE_TYPES` registry. Every node type declares its own shape, color, extra fields, and how it contributes to the prompt. Adding a new type in the future requires only one new entry in this object.

```js
NODE_TYPES = {
  // Existing types (migrated)
  process:  { label, shape: "rect",    color, fields: [],   promptRole: "step"      },
  data:     { label, shape: "rect",    color, fields: [],   promptRole: "datastore" },
  api:      { label, shape: "rect",    color, fields: [],   promptRole: "api"       },
  ui:       { label, shape: "rect",    color, fields: [],   promptRole: "ui"        },
  external: { label, shape: "rect",    color, fields: [],   promptRole: "external"  },

  // New logical types
  decision: { label, shape: "diamond", color, fields: [],   promptRole: "branch"    },
  loop:     { label, shape: "rect",    color,
              fields: [{ key: "iterateOver", label: "iterate over", placeholder: "orders[], range(0,10)…" }],
              hasChildren: true, promptRole: "iteration" },
  trigger:  { label, shape: "rounded", color,
              fields: [
                { key: "triggerType",   label: "type",   type: "select",
                  options: ["User Action","Timer/Cron","Webhook","System Event"] },
                { key: "triggerDetail", label: "detail", placeholder: "POST /api/orders…" },
              ],
              promptRole: "trigger" },
  error:    { label, shape: "rect",    color,
              hasChildren: true, promptRole: "error" },
}
```

**Key principle:** rendering, Properties panel fields, and prompt serialization all read from this registry — no scattered `if (type === "decision")` blocks.

### Color palette

| Type | Background | Border |
|---|---|---|
| process | `#fdfcf8` | `#1c1b17` |
| data | `#f0ece0` | `#1c1b17` |
| api | `#f5f2e8` | `#1c1b17` |
| ui | `#fdfcf8` | `#1c1b17` |
| external | `#edeadf` | `#1c1b17` |
| decision | `#f5f0e8` | `#8a7a5a` |
| loop | `#eaf0f5` | `#5a7a8a` |
| trigger | `#eef5ea` | `#5a8a5a` |
| error | `#f5eaea` | `#8a3a3a` |

---

## 2. Visual Rendering

### Decision `◇`
- SVG `<polygon>` with 4 points fitting the standard `NW×NH` bounding box:
  `top(NW/2, 0)` · `right(NW, NH/2)` · `bottom(NW/2, NH)` · `left(0, NH/2)`
- Label centered in italic
- N outgoing edges, each with a free-text label representing the branch condition
- No limit on outgoing branches (covers if/else, switch/case, routing)
- Edge connection points snap to the 4 diamond vertices by direction

### Loop `↻`
- Standard rectangle + `↻` icon top-right
- Secondary line below label: `iterate over: orders[]` in grey italic
- Double-click → enters body sub-diagram (same `children` mechanism already in place)
- `⊞` indicator shown when body exists

### Trigger `⚡`
- Rectangle with rounded corners (`rx=12` on SVG `<rect>`)
- Category badge at top: `USER ACTION` / `TIMER` / `WEBHOOK` / `SYSTEM` with per-category color tint
- Detail text below label in grey
- By convention placed at the left edge of the canvas (entry point)

### Error Handler `⚠`
- Rectangle with red dashed border (`stroke-dasharray="6 3"`, `stroke="#8a3a3a"`)
- `⚠` icon top-left
- Double-click → enters recovery logic sub-diagram
- `⊞` indicator when body exists

### `onError` edges
- Any node can have one outgoing edge with `kind: "error"`
- Rendered as red dashed line `stroke="#a83228"` with `stroke-dasharray="5 3"`
- Fixed label `⚠ onError` near midpoint
- Destination must be a node of type `error`
- In Properties panel: `+ add error handler` button appears at the bottom of every node's panel, initiates `ADD_EDGE` mode pre-filtered to `error` nodes

---

## 3. Prompt Engine

### Scenario detection

| Condition | Auto scenario |
|---|---|
| `aiBaseDiagram === null` | **New Project** |
| `aiBaseDiagram` exists (any diff) | **Update Existing** |

A segmented control in the topbar shows the auto-detected value (`auto: New Project`). The user can override it; the badge changes to `override: Update Existing` with an `×` to revert to auto.

### Output format

The title defaults to the project name detected during file analysis (from `fileInfo.name`), or `"Untitled Project"` if no files were loaded. It is shown as an editable field in the Prompt tab before the user copies the output.

```markdown
# [Project / Feature Name] — Implementation Plan

## Context
[What is being built and why]

## Scenario: New Project | Update Existing
[Scenario-specific section — see below]

## Architecture Overview
[Diagram summary: nodes and key relationships]

## Entry Points
[All Trigger nodes with type and detail]

## Implementation Steps
[Topologically ordered steps — one per node]

## Error Handling
[All onError edges + recovery logic]

## Data Flow Summary
[All edges: A → B (label)]
```

### Node serialisation

**Trigger:**
```
## Entry Points
### ⚡ Trigger: New Order [Webhook]
Event: POST /api/orders
Starts flow: Step 1 → Step 2 → Step 3
```

**Decision:**
```
### Step 3 — Check User Role [decision]
Condition: user.role
  → "admin" : proceed to Step 4 (Admin Panel)
  → "user"  : proceed to Step 5 (Dashboard)
  → "guest" : proceed to Step 6 (Login)
```

**Loop:**
```
### Step 4 — Process Orders [loop]
Iterates over: orders[]
For each iteration:
  - Step 4.1 — Validate Order [process]
  - Step 4.2 — Calculate Total [process]
  - Step 4.3 — Send Confirmation [api]
```

**Error Handler:**
```
## Error Handling
### ⚠ onError from: Process Payment
Handler: Payment Error Handler
Recovery logic:
  - Step E1 — Log Error [process]
  - Step E2 — Notify User [api]
  - Step E3 — Rollback Transaction [data]
```

### Scenario-specific sections

**New Project** adds:
```
## Project Structure
Suggested directory layout based on architecture:
/src
  /triggers   ← Trigger nodes
  /handlers   ← Process / API nodes
  /models     ← Data nodes
  /errors     ← Error Handler nodes

## Stack
[No files loaded — Claude Code confirms stack before proceeding]
```

**Update Existing** adds:
```
## Current Architecture
[Baseline node summary from aiBaseDiagram]

## Changes Required
[Full diff: added nodes, removed nodes, modified nodes, changed edges]
Implement all listed changes. Preserve everything not mentioned.
```

---

## 4. UI Changes

### Toolbar — Add Node dropdown

```
Add node ▾
──────────────────
Process
Data Store
API
UI Layer
External
──────────────────   ← visual separator
◇ Decision
↻ Loop
⚡ Trigger
⚠ Error Handler
```

### Properties panel — new fields

Fields are rendered generically from `NODE_TYPES[type].fields`:

- **Decision:** no extra fields — branch logic lives on the outgoing edges. Panel shows a hint: *"add an edge for each branch condition"*.
- **Loop:** `iterate over` text input rendered from `fields` definition.
- **Trigger:** `type` select + `detail` text input rendered from `fields` definition.
- **Error Handler:** no extra fields beyond label/desc. Panel shows `⊞ enter recovery body`.

**onError section** (bottom of every node's Properties panel, all types):
```
─────────────────
ON ERROR
[ + add error handler ]
```

### Topbar — scenario control

```
[ auto: New Project ▾ ]    generate prompt →
```

Dropdown options: `New Project` / `Update Existing`.
When overridden: `[ override: Update Existing ▾ × ]`.

---

## Out of scope

- Undo/redo
- Multi-select / align tools
- Minimap
- Keyboard shortcut system
- Export to other formats

These are acknowledged improvements but excluded from this implementation to keep scope focused.

---

## Files affected

| File | Changes |
|---|---|
| `src/App.jsx` | Replace `NT` with `NODE_TYPES` registry; add diamond SVG rendering; add `iterateOver`/`triggerType`/`triggerDetail` fields; add `onError` edge kind; update `generatePrompt` with scenario engine and new node serialisation; add scenario segmented control to topbar |
