# Visual Programming Nodes & Prompt Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four new node types (Decision, Loop, Trigger, Error Handler) with a registry-driven rendering system and a fully reworked Claude Code implementation prompt engine.

**Architecture:** All changes are confined to `src/App.jsx`. Node types are centralized in a `NODE_TYPES` registry — each type declares its shape, color, extra fields, and prompt role, eliminating scattered `if (type==="...")` checks. The prompt engine uses topological ordering and scenario detection (New Project vs Update Existing) to produce a structured Claude Code implementation plan.

**Tech Stack:** React 18 (hooks), SVG canvas, no build-time type system, no test framework. Verify correctness by running the dev server (`npm run dev`, localhost:5173).

---

### Task 1: NODE_TYPES registry

**Files:**
- Modify: `src/App.jsx:8-14` (replace `NT`), `:985` (update `nodeFill`), `:1020` (topbar dropdown), `:1129` (props type select), `:1415` (status bar)

- [ ] **Step 1: Replace `NT` constant with `NODE_TYPES` registry**

  At `src/App.jsx:8`, replace:
  ```js
  const NT = {
    process:  { label: "Process"    },
    data:     { label: "Data Store" },
    api:      { label: "API"        },
    ui:       { label: "UI Layer"   },
    external: { label: "External"   },
  };
  ```
  With:
  ```js
  const NODE_TYPES = {
    process:  { label:"Process",       shape:"rect",    color:{bg:"#fdfcf8",bd:"#1c1b17"}, fields:[],
                promptRole:"step" },
    data:     { label:"Data Store",    shape:"rect",    color:{bg:"#f0ece0",bd:"#1c1b17"}, fields:[],
                promptRole:"datastore" },
    api:      { label:"API",           shape:"rect",    color:{bg:"#f5f2e8",bd:"#1c1b17"}, fields:[],
                promptRole:"api" },
    ui:       { label:"UI Layer",      shape:"rect",    color:{bg:"#fdfcf8",bd:"#1c1b17"}, fields:[],
                promptRole:"ui" },
    external: { label:"External",      shape:"rect",    color:{bg:"#edeadf",bd:"#1c1b17"}, fields:[],
                promptRole:"external" },
    decision: { label:"Decision",      shape:"diamond", color:{bg:"#f5f0e8",bd:"#8a7a5a"}, fields:[],
                promptRole:"branch" },
    loop:     { label:"Loop",          shape:"rect",    color:{bg:"#eaf0f5",bd:"#5a7a8a"},
                fields:[{key:"iterateOver",label:"iterate over",placeholder:"orders[], range(0,10)…"}],
                hasChildren:true, promptRole:"iteration" },
    trigger:  { label:"Trigger",       shape:"rounded", color:{bg:"#eef5ea",bd:"#5a8a5a"},
                fields:[
                  {key:"triggerType",   label:"type",   type:"select", options:["User Action","Timer/Cron","Webhook","System Event"]},
                  {key:"triggerDetail", label:"detail", placeholder:"POST /api/orders…"},
                ],
                promptRole:"trigger" },
    error:    { label:"Error Handler", shape:"rect",    color:{bg:"#f5eaea",bd:"#8a3a3a"}, fields:[],
                hasChildren:true, promptRole:"error" },
  };
  ```

- [ ] **Step 2: Update `nodeFill` helper (line ~985)**

  Replace:
  ```js
  const nodeFill=t=>({process:P.paper,data:"#f0ece0",api:"#f5f2e8",ui:P.paper,external:"#edeadf"}[t]||P.paper);
  ```
  With:
  ```js
  const nodeFill  = t => NODE_TYPES[t]?.color.bg || P.paper;
  const nodeBorder= t => NODE_TYPES[t]?.color.bd || P.ink;
  ```

- [ ] **Step 3: Update three references from `NT` to `NODE_TYPES`**

  **Topbar dropdown (line ~1020):** replace `Object.entries(NT)` → `Object.entries(NODE_TYPES)`.

  **Props type select (line ~1129):** replace `Object.entries(NT)` → `Object.entries(NODE_TYPES)`.

  **Status bar (line ~1415):** replace `NT[newType]?.label` → `NODE_TYPES[newType]?.label`.

- [ ] **Step 4: Start dev server and verify**

  ```bash
  npm run dev
  ```
  Expected: app loads, the existing 5 types appear in the Add Node dropdown and the Properties panel type select, no console errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/App.jsx
  git commit -m "refactor: replace NT constant with NODE_TYPES registry"
  ```

---

### Task 2: New node shapes in SVG canvas

**Files:**
- Modify: `src/App.jsx` — add `NodeBg` component before `Label`, replace background+badge block in node rendering loop

- [ ] **Step 1: Add `NodeBg` helper component after `computeDiagramDiff` (line ~626)**

  Insert this block between `computeDiagramDiff` and the `Label` helper:
  ```js
  function NodeBg({type, isSel, isSrc, isBoundary}) {
    const t  = NODE_TYPES[type] || NODE_TYPES.process;
    const bg = isBoundary ? "#f0ede0" : t.color.bg;
    const bd = isBoundary ? "#8a8880" : t.color.bd;
    const sw = isSel || isSrc ? 1 : 0.55;
    if (t.shape === "diamond") {
      const pts = `${NW/2},0 ${NW},${NH/2} ${NW/2},${NH} 0,${NH/2}`;
      return <polygon points={pts} fill={bg} stroke={bd} strokeWidth={sw}/>;
    }
    if (t.shape === "rounded") {
      return <rect x={0} y={0} width={NW} height={NH} rx={12} fill={bg} stroke={bd} strokeWidth={sw}/>;
    }
    const dash = type === "error" ? "6 3" : (isBoundary ? "5 3" : undefined);
    return <rect x={0} y={0} width={NW} height={NH} fill={bg} stroke={bd} strokeWidth={sw} strokeDasharray={dash}/>;
  }
  ```

- [ ] **Step 2: Replace the background rect + type badge + label block inside the node rendering loop**

  Find the block starting at the selection highlight rect down to `{n.desc&&<text...}` (lines ~1357–1369). That block is:
  ```jsx
  {(isSel||isSrc)&&<rect x={-5} y={-5} width={NW+10} height={NH+10} fill="none" stroke={P.ink} strokeWidth={.8} strokeDasharray="4 3"/>}
  <rect x={0} y={0} width={NW} height={NH}
    fill={isBoundary?"#f0ede0":nodeFill(n.type)}
    stroke={isBoundary?P.dim:P.ink}
    strokeWidth={isSel||isSrc?1:.55}
    strokeDasharray={isBoundary?"5 3":undefined}/>
  <text x={9} y={15} fontSize={7.5} fill={P.dim} fontFamily="'Courier Prime',monospace" fontWeight="700" letterSpacing={1.5}>
    {isBoundary?(n._boundary==="input"?"INPUT ▶":"▶ OUTPUT"):n.type.toUpperCase()}
  </text>
  <text x={NW/2} y={n.desc?NH/2+3:NH/2+6} textAnchor="middle" fontSize={14} fill={P.ink} fontFamily="'Instrument Serif',serif" fontStyle="italic">
    {n.label.length>22?n.label.slice(0,20)+"…":n.label}
  </text>
  {n.desc&&<text x={NW/2} y={NH-10} textAnchor="middle" fontSize={9} fill={P.dim} fontFamily="'Courier Prime',monospace">{n.desc.length>28?n.desc.slice(0,26)+"…":n.desc}</text>}
  ```

  Replace it with:
  ```jsx
  {(isSel||isSrc)&&<rect x={-5} y={-5} width={NW+10} height={NH+10} fill="none" stroke={P.ink} strokeWidth={.8} strokeDasharray="4 3"/>}
  <NodeBg type={n.type} isSel={isSel} isSrc={isSrc} isBoundary={isBoundary}/>

  {/* type badge / special top text */}
  {isBoundary
    ? <text x={9} y={15} fontSize={7.5} fill={P.dim} fontFamily="'Courier Prime',monospace" fontWeight="700" letterSpacing={1.5}>{n._boundary==="input"?"INPUT ▶":"▶ OUTPUT"}</text>
    : n.type==="trigger"
      ? (()=>{
          const cat=(n.triggerType||"User Action").replace("/Cron","").toUpperCase();
          return <text x={NW/2} y={13} textAnchor="middle" fontSize={7} fill={NODE_TYPES.trigger.color.bd} fontFamily="'Courier Prime',monospace" fontWeight="700" letterSpacing={1.2}>⚡ {cat}</text>;
        })()
      : <text x={9} y={15} fontSize={7.5} fill={P.dim} fontFamily="'Courier Prime',monospace" fontWeight="700" letterSpacing={1.5}>
          {(NODE_TYPES[n.type]?.label||n.type).toUpperCase()}{n.type==="loop"?" ↻":n.type==="error"?" ⚠":""}
        </text>
  }

  {/* main label */}
  {n.type==="decision"
    ? <text x={NW/2} y={NH/2+5} textAnchor="middle" fontSize={13} fill={P.ink} fontFamily="'Instrument Serif',serif" fontStyle="italic">
        {n.label.length>18?n.label.slice(0,16)+"…":n.label}
      </text>
    : <text x={NW/2} y={(n.desc||(n.type==="loop"&&n.iterateOver))?NH/2+3:NH/2+6} textAnchor="middle" fontSize={14} fill={P.ink} fontFamily="'Instrument Serif',serif" fontStyle="italic">
        {n.label.length>22?n.label.slice(0,20)+"…":n.label}
      </text>
  }

  {/* description (not shown on loop — iterate-over takes that slot) */}
  {n.desc&&n.type!=="loop"&&<text x={NW/2} y={NH-10} textAnchor="middle" fontSize={9} fill={P.dim} fontFamily="'Courier Prime',monospace">{n.desc.length>28?n.desc.slice(0,26)+"…":n.desc}</text>}

  {/* loop iterate-over subtitle */}
  {n.type==="loop"&&n.iterateOver&&!isBoundary&&(
    <text x={NW/2} y={NH-9} textAnchor="middle" fontSize={8} fill={P.dim} fontFamily="'Courier Prime',monospace" fontStyle="italic">
      {n.iterateOver.length>22?n.iterateOver.slice(0,20)+"…":n.iterateOver}
    </text>
  )}
  ```

- [ ] **Step 3: Verify in browser**

  ```bash
  npm run dev
  ```
  - Add a **Decision** node → renders as a diamond (◇ shape).
  - Add a **Trigger** node → renders with rounded corners and ⚡ USER ACTION badge.
  - Add a **Loop** node → shows LOOP ↻ badge; after setting iterate-over field shows subtitle.
  - Add an **Error Handler** → shows red dashed border and ⚠ suffix.
  - Existing process/data/api/ui/external nodes unchanged.

- [ ] **Step 4: Commit**

  ```bash
  git add src/App.jsx
  git commit -m "feat: add new node shapes (diamond, rounded, dashed) driven by NODE_TYPES"
  ```

---

### Task 3: onError edge kind

**Files:**
- Modify: `src/App.jsx` — add `pendingEdgeKind` state, update `onNodeDown`, update SVG defs, update edge rendering

- [ ] **Step 1: Add `pendingEdgeKind` state**

  After the line `const [edgeSrcPort,setEdgeSrcPort] = useState(null);` (line ~636), add:
  ```js
  const [pendingEdgeKind,setPendingEdgeKind] = useState(null);
  ```

- [ ] **Step 2: Update `onNodeDown` to validate and tag error edges**

  In the `ADD_EDGE` branch of `onNodeDown` (lines ~788–793), replace:
  ```js
  if(mode==="ADD_EDGE"){
    if(!edgeSrc){setEdgeSrc(id);setEdgeSrcPort(null);return;}
    if(edgeSrc!==id) setEdges(es=>[...es,mkEdge(edgeSrc,id,"",edgeSrcPort?.portId||null,null)]);
    else             setEdges(es=>[...es,mkEdge(id,id,"")]);
    setEdgeSrc(null);setEdgeSrcPort(null);setMode("SELECT");
    return;
  }
  ```
  With:
  ```js
  if(mode==="ADD_EDGE"){
    if(!edgeSrc){setEdgeSrc(id);setEdgeSrcPort(null);return;}
    if(edgeSrc!==id){
      const tgt=nodes.find(n=>n.id===id);
      if(pendingEdgeKind==="error"&&tgt?.type!=="error"){
        setErr("Connect error handler only to an Error Handler node (⚠)");
        setTimeout(()=>setErr(""),3000);
        setEdgeSrc(null);setEdgeSrcPort(null);setPendingEdgeKind(null);setMode("SELECT");
        return;
      }
      const extra=pendingEdgeKind?{kind:pendingEdgeKind}:{};
      setEdges(es=>[...es,{...mkEdge(edgeSrc,id,"",edgeSrcPort?.portId||null,null),...extra}]);
    } else {
      setEdges(es=>[...es,mkEdge(id,id,"")]);
    }
    setEdgeSrc(null);setEdgeSrcPort(null);setPendingEdgeKind(null);setMode("SELECT");
    return;
  }
  ```

  Also add `pendingEdgeKind` to the `useCallback` dependency array of `onNodeDown`:
  ```js
  },[mode,edgeSrc,edgeSrcPort,pendingEdgeKind,nodes,sel,toSvg]);
  ```

- [ ] **Step 3: Add red error arrow marker in SVG `<defs>`**

  In the `<defs>` block (around lines 1304–1313), after the last `</g>` of the existing markers, add:
  ```jsx
  <marker id="mk-err" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
    <path d="M0,0 L0,6 L7,3 z" fill="#a83228"/>
  </marker>
  ```

- [ ] **Step 4: Update edge rendering to style `kind: "error"` edges**

  Find the visible-edge `<path>` (around line 1329–1333):
  ```jsx
  <path d={e.path} fill="none"
    stroke={P.ink} strokeWidth={isSel?1.5:.85} opacity={isSel?1:.42}
    markerEnd={`url(#${isSel?"mk-s":"mk"})`}
    markerStart={e.bidir&&!e.selfLoop?`url(#${isSel?"mk-bs":"mk-b"})`:undefined}
    strokeDasharray={mode==="DELETE"?"5 3":undefined}/>
  ```
  Replace with:
  ```jsx
  <path d={e.path} fill="none"
    stroke={e.kind==="error"?"#a83228":P.ink}
    strokeWidth={isSel?1.5:.85}
    opacity={isSel?1:.42}
    markerEnd={e.kind==="error"?"url(#mk-err)":`url(#${isSel?"mk-s":"mk"})`}
    markerStart={e.bidir&&!e.selfLoop?`url(#${isSel?"mk-bs":"mk-b"})`:undefined}
    strokeDasharray={e.kind==="error"?"5 3":(mode==="DELETE"?"5 3":undefined)}/>
  {e.kind==="error"&&!e.label&&(
    <g>
      <rect x={e.mx-22} y={e.my-13} width={44} height={14} fill={P.cream}/>
      <text x={e.mx} y={e.my-2} textAnchor="middle" fontSize={9} fill="#a83228" fontFamily="'Courier Prime',monospace" fontStyle="italic">⚠ onError</text>
    </g>
  )}
  ```

- [ ] **Step 5: Verify in browser**

  - Add a **Process** node and an **Error Handler** node.
  - Connect them using the "+ add error handler" button (Task 4, step 3) — will be done in the next task.
  - For now, use ADD_EDGE mode manually: the app should accept the connection and render it as a red dashed line with ⚠ onError label only after Task 4.

- [ ] **Step 6: Commit**

  ```bash
  git add src/App.jsx
  git commit -m "feat: add onError edge kind with red dashed rendering and validation"
  ```

---

### Task 4: Properties panel — generic fields and onError section

**Files:**
- Modify: `src/App.jsx` — props panel selNode section (lines ~1120–1187)

- [ ] **Step 1: Update type `<select>` to use `NODE_TYPES`**

  Find:
  ```jsx
  <select value={selNode.type} onChange={e=>updNode(selNode.id,{type:e.target.value})} style={IS}>
    {Object.entries(NT).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
  </select>
  ```
  Replace with:
  ```jsx
  <select value={selNode.type} onChange={e=>updNode(selNode.id,{type:e.target.value})} style={IS}>
    {Object.entries(NODE_TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
  </select>
  ```

- [ ] **Step 2: Add generic field rendering after the description `<textarea>`**

  After:
  ```jsx
  <textarea value={selNode.desc||""} onChange={e=>updNode(selNode.id,{desc:e.target.value})} rows={2} style={{...IS,resize:"vertical"}}/>
  ```
  Add:
  ```jsx
  {(NODE_TYPES[selNode.type]?.fields||[]).map(f=>(
    <div key={f.key}>
      <Label>{f.label}</Label>
      {f.type==="select"
        ? <select value={selNode[f.key]||f.options[0]} onChange={e=>updNode(selNode.id,{[f.key]:e.target.value})} style={IS}>
            {f.options.map(o=><option key={o} value={o}>{o}</option>)}
          </select>
        : <input value={selNode[f.key]||""} onChange={e=>updNode(selNode.id,{[f.key]:e.target.value})} placeholder={f.placeholder||""} style={IS}/>
      }
    </div>
  ))}
  {selNode.type==="decision"&&(
    <div style={{fontSize:9,color:P.dim,fontStyle:"italic",lineHeight:1.6,marginTop:3}}>
      add an edge for each branch — use the edge label as the condition value
    </div>
  )}
  ```

- [ ] **Step 3: Replace bottom buttons with updated set (enter body + onError section + delete)**

  Find (lines ~1165–1167):
  ```jsx
  <button onClick={()=>{setEdgeSrc(selNode.id);setMode("ADD_EDGE");}} style={{...BS(false),padding:"5px",fontSize:10,width:"100%",marginTop:4}}>→ connect to another node</button>
  <button onClick={()=>{setNodes(ns=>ns.filter(n=>n.id!==selNode.id));setEdges(es=>es.filter(e=>e.from!==selNode.id&&e.to!==selNode.id));setSel(null);}} style={{...BS(false,true),padding:"5px",fontSize:10,width:"100%"}}>× delete node</button>
  ```
  Replace with:
  ```jsx
  {NODE_TYPES[selNode.type]?.hasChildren&&(
    <button onClick={()=>enterNode(selNode)} style={{...BS(false),padding:"5px",fontSize:10,width:"100%",marginTop:4}}>
      ⊞ enter {selNode.type==="loop"?"loop body":"recovery body"}
    </button>
  )}
  <button onClick={()=>{setEdgeSrc(selNode.id);setMode("ADD_EDGE");}} style={{...BS(false),padding:"5px",fontSize:10,width:"100%",marginTop:4}}>→ connect to another node</button>
  <HR/>
  <div style={{fontSize:9,fontWeight:700,letterSpacing:1.8,color:"#a83228",marginTop:2}}>ON ERROR</div>
  <button onClick={()=>{setSel(null);setEdgeSrc(selNode.id);setPendingEdgeKind("error");setMode("ADD_EDGE");}}
    style={{...BS(false),padding:"5px",fontSize:10,width:"100%",borderColor:"#a83228",color:"#a83228"}}>
    + add error handler
  </button>
  <HR/>
  <button onClick={()=>{setNodes(ns=>ns.filter(n=>n.id!==selNode.id));setEdges(es=>es.filter(e=>e.from!==selNode.id&&e.to!==selNode.id));setSel(null);}} style={{...BS(false,true),padding:"5px",fontSize:10,width:"100%"}}>× delete node</button>
  ```

- [ ] **Step 4: Verify in browser**

  - Select a **Loop** node → props shows "iterate over" input + "⊞ enter loop body" button.
  - Select a **Trigger** node → props shows "type" select (User Action / Timer/Cron / Webhook / System Event) + "detail" text input.
  - Select a **Decision** node → props shows the branch hint text.
  - Every node shows the ON ERROR section with "+ add error handler" button.
  - Click "+ add error handler" on a Process node, then click an Error Handler node → red dashed ⚠ onError edge appears.
  - Click "+ add error handler" and then click a non-error-handler node → shows error message.

- [ ] **Step 5: Commit**

  ```bash
  git add src/App.jsx
  git commit -m "feat: generic field rendering in props panel, onError section, enter body button"
  ```

---

### Task 5: Grouped Add Node dropdown

**Files:**
- Modify: `src/App.jsx` — topbar Add Node `<select>` (lines ~1017–1022)

- [ ] **Step 1: Replace flat `<select>` with grouped `<optgroup>` select**

  Find:
  ```jsx
  {mode==="ADD_NODE"&&(
    <select value={newType} onChange={e=>setNewType(e.target.value)}
      style={{...IS,width:"auto",marginTop:0,padding:"3px 7px"}}>
      {Object.entries(NT).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
    </select>
  )}
  ```
  Replace with:
  ```jsx
  {mode==="ADD_NODE"&&(
    <select value={newType} onChange={e=>setNewType(e.target.value)}
      style={{...IS,width:"auto",marginTop:0,padding:"3px 7px"}}>
      <optgroup label="structural">
        {["process","data","api","ui","external"].map(k=>(
          <option key={k} value={k}>{NODE_TYPES[k].label}</option>
        ))}
      </optgroup>
      <optgroup label="logical">
        {["decision","loop","trigger","error"].map(k=>(
          <option key={k} value={k}>{NODE_TYPES[k].label}</option>
        ))}
      </optgroup>
    </select>
  )}
  ```

- [ ] **Step 2: Verify in browser**

  Click "Add node" button → dropdown shows two groups: "structural" (Process, Data Store, API, UI Layer, External) and "logical" (Decision, Loop, Trigger, Error Handler).

- [ ] **Step 3: Commit**

  ```bash
  git add src/App.jsx
  git commit -m "feat: grouped Add Node dropdown with structural and logical node types"
  ```

---

### Task 6: Topbar scenario control

**Files:**
- Modify: `src/App.jsx` — add state, derived value, topbar control, reset in `handleFiles`

- [ ] **Step 1: Add `scenarioOverride` state**

  After line 654 (`const [aiBaseDiagram,setAiBaseDiagram] = useState(null);`), add:
  ```js
  const [scenarioOverride,setScenarioOverride] = useState(null); // null | "new" | "update"
  ```

- [ ] **Step 2: Derive `autoScenario` and `activeScenario`**

  Immediately after the `scenarioOverride` state line, add:
  ```js
  const autoScenario   = aiBaseDiagram===null ? "new" : "update";
  const activeScenario = scenarioOverride || autoScenario;
  ```

- [ ] **Step 3: Reset override when AI analysis completes**

  In `handleFiles` (line ~874), after `setAiBaseDiagram({nodes:positioned, edges:newEdges});`, add:
  ```js
  setScenarioOverride(null);
  ```

- [ ] **Step 4: Add scenario control to topbar, before "generate prompt →"**

  Find (lines ~1040–1043):
  ```jsx
  <button onClick={generatePrompt}
    style={{...BS(false),borderColor:P.ink,color:P.ink,fontWeight:700,padding:"4px 14px"}}>
    generate prompt →
  </button>
  ```
  Replace with:
  ```jsx
  <div style={{display:"flex",alignItems:"center",gap:3}}>
    <select
      value={activeScenario}
      onChange={e=>{const v=e.target.value;setScenarioOverride(v===autoScenario?null:v);}}
      title={scenarioOverride?"manual override":"auto-detected"}
      style={{...IS,marginTop:0,padding:"3px 7px",width:"auto",
        fontStyle:scenarioOverride?"normal":"italic",
        color:scenarioOverride?P.ink:P.dim}}>
      <option value="new">{scenarioOverride===null&&autoScenario==="new"?"auto: ":""}New Project</option>
      <option value="update">{scenarioOverride===null&&autoScenario==="update"?"auto: ":""}Update Existing</option>
    </select>
    {scenarioOverride&&(
      <button onClick={()=>setScenarioOverride(null)}
        title="revert to auto"
        style={{...BS(false),padding:"3px 6px",fontSize:11}}>×</button>
    )}
  </div>
  <button onClick={generatePrompt}
    style={{...BS(false),borderColor:P.ink,color:P.ink,fontWeight:700,padding:"4px 14px"}}>
    generate prompt →
  </button>
  ```

- [ ] **Step 5: Verify in browser**

  - Default: selector shows `auto: New Project` in dim/italic (no files loaded).
  - Select "Update Existing" → shows in normal style + `×` button appears.
  - Click `×` → reverts to `auto: New Project`.
  - Load a project folder → selector resets to `auto: Update Existing` (aiBaseDiagram is set).

- [ ] **Step 6: Commit**

  ```bash
  git add src/App.jsx
  git commit -m "feat: topbar scenario control with auto-detect and manual override"
  ```

---

### Task 7: Prompt engine rewrite

**Files:**
- Modify: `src/App.jsx` — add `promptTitle` state + reset, add `topoSort` helper, rewrite `generatePrompt`, update Prompt tab UI

- [ ] **Step 1: Add `promptTitle` state**

  After `const [promptTxt,setPromptTxt]=useState("");` (line ~645), add:
  ```js
  const [promptTitle,setPromptTitle] = useState("Untitled Project");
  ```

  In `handleFiles`, after `setFileInfo({name:projectName,...})`, add:
  ```js
  setPromptTitle(arr[0]?.webkitRelativePath?.split("/")[0]||arr[0]?.name||"project");
  ```

- [ ] **Step 2: Add `topoSort` helper after `computeDiagramDiff` (before `NodeBg`)**

  ```js
  function topoSort(nodes, edges) {
    const inDeg={}, adj={};
    nodes.forEach(n=>{ inDeg[n.id]=0; adj[n.id]=[]; });
    edges.forEach(e=>{
      if(adj[e.from]&&inDeg[e.to]!==undefined&&e.kind!=="error"){
        adj[e.from].push(e.to);
        inDeg[e.to]++;
      }
    });
    const queue=nodes.filter(n=>inDeg[n.id]===0).map(n=>n.id);
    const result=[];
    while(queue.length){
      const cur=queue.shift();
      result.push(cur);
      for(const nb of (adj[cur]||[])){ if(--inDeg[nb]===0) queue.push(nb); }
    }
    nodes.forEach(n=>{ if(!result.includes(n.id)) result.push(n.id); });
    return result.map(id=>nodes.find(n=>n.id===id)).filter(Boolean);
  }
  ```

- [ ] **Step 3: Rewrite `generatePrompt` (replace lines ~921–967)**

  Replace the entire `const generatePrompt=()=>{...};` block with:
  ```js
  const generatePrompt=()=>{
    const allNodes=rootDiagram.nodes, allEdges=rootDiagram.edges;
    const nLabel=id=>allNodes.find(n=>n.id===id)?.label||id;
    const outEdgesOf=id=>allEdges.filter(e=>e.from===id&&e.kind!=="error");
    const errEdgesOf=id=>allEdges.filter(e=>e.from===id&&e.kind==="error");
    const sorted=topoSort(allNodes,allEdges);
    const stepNum={}; sorted.forEach((n,i)=>stepNum[n.id]=i+1);
    const scenario=activeScenario;

    // Entry Points
    const triggers=sorted.filter(n=>n.type==="trigger");
    const entrySection=triggers.length
      ? `## Entry Points\n\n${triggers.map(n=>{
          const cat=n.triggerType||"User Action";
          const firstOut=outEdgesOf(n.id)[0];
          const flowStart=firstOut?`Step ${stepNum[firstOut.to]} — ${nLabel(firstOut.to)}`:"(no outgoing connections)";
          return `### ⚡ Trigger: ${n.label} [${cat}]\nEvent: ${n.triggerDetail||"(no detail)"}\nStarts flow: ${flowStart}`;
        }).join("\n\n")}\n\n`
      : "";

    // Implementation Steps (skip triggers and error handlers — they appear in other sections)
    const stepNodes=sorted.filter(n=>n.type!=="trigger"&&n.type!=="error");
    const stepsSection=`## Implementation Steps\n\n${stepNodes.map(n=>{
      const num=stepNum[n.id];
      const role=NODE_TYPES[n.type]?.promptRole||n.type;
      let body=`### Step ${num} — ${n.label} [${role}]`;
      if(n.desc) body+=`\n${n.desc}`;
      if(n.type==="decision"){
        body+=`\nCondition: ${n.label}`;
        outEdgesOf(n.id).forEach(e=>{
          body+=`\n  → "${e.label||"(branch)"}" : proceed to Step ${stepNum[e.to]||"?"} — ${nLabel(e.to)}`;
        });
      } else if(n.type==="loop"){
        body+=`\nIterates over: ${n.iterateOver||"(collection)"}`;
        if(n.children?.nodes?.length){
          body+=`\nFor each iteration:\n${n.children.nodes.map((c,i)=>(
            `  - Step ${num}.${i+1} — ${c.label} [${NODE_TYPES[c.type]?.promptRole||c.type}]`
          )).join("\n")}`;
        }
      } else {
        const nexts=outEdgesOf(n.id);
        if(nexts.length) body+=`\nOutputs to: ${nexts.map(e=>`Step ${stepNum[e.to]||"?"} — ${nLabel(e.to)}${e.label?" ("+e.label+")":""}`).join(", ")}`;
      }
      return body;
    }).join("\n\n")}\n\n`;

    // Error Handling
    const errorEdges=allEdges.filter(e=>e.kind==="error");
    const errorSection=errorEdges.length
      ? `## Error Handling\n\n${errorEdges.map(e=>{
          const src=nLabel(e.from);
          const dst=allNodes.find(n=>n.id===e.to);
          let body=`### ⚠ onError from: ${src}\nHandler: ${dst?.label||"(unknown)"}`;
          if(dst?.children?.nodes?.length){
            body+=`\nRecovery logic:\n${dst.children.nodes.map((c,i)=>(
              `  - Step E${i+1} — ${c.label} [${NODE_TYPES[c.type]?.promptRole||c.type}]`
            )).join("\n")}`;
          }
          return body;
        }).join("\n\n")}\n\n`
      : "";

    // Data Flow Summary
    const flowSection=`## Data Flow Summary\n\n${allEdges.filter(e=>e.kind!=="error").map(e=>{
      const fn=nLabel(e.from), tn=nLabel(e.to);
      return `${fn} ${e.bidir?"↔":"→"} ${tn}${e.label?" ("+e.label+")":""}`;
    }).join("\n")}\n\n`;

    // Scenario-specific sections
    let scenarioSpecific="";
    if(scenario==="new"){
      scenarioSpecific=`## Project Structure\n\nSuggested directory layout:\n\`\`\`\n/src\n  /triggers   ← Trigger nodes\n  /handlers   ← Process / API nodes\n  /models     ← Data nodes\n  /errors     ← Error Handler nodes\n\`\`\`\n\n## Stack\n\n[No files loaded — confirm tech stack with Claude Code before proceeding]\n\n`;
    } else {
      const diffs=aiBaseDiagram?computeDiagramDiff(aiBaseDiagram,rootDiagram):[];
      const hasChanges=diffs.some(d=>d.added.length||d.removed.length||d.modified.length||d.addedE.length||d.removedE.length);
      const baseList=(aiBaseDiagram?.nodes||allNodes).map(n=>`- **${n.label}** [${n.type}]${n.desc?": "+n.desc:""}`).join("\n");
      const changeLines=hasChanges?diffs.flatMap(({path,added,removed,modified,addedE,removedE,baseNodes})=>{
        const ls=[];
        if(added.length||removed.length||modified.length||addedE.length||removedE.length) ls.push(`### ${path}`);
        added.forEach(n=>ls.push(`- Add node: **${n.label}** [${n.type}]${n.desc?": "+n.desc:""}`));
        removed.forEach(n=>ls.push(`- Remove node: **${n.label}** [${n.type}]`));
        modified.forEach(n=>{
          const o=baseNodes?.find(x=>x.id===n.id);
          const ch=[];
          if(o?.label!==n.label) ch.push(`label "${o?.label}" → "${n.label}"`);
          if(o?.type!==n.type)   ch.push(`type ${o?.type} → ${n.type}`);
          if(o?.desc!==n.desc)   ch.push(`desc "${o?.desc||""}" → "${n.desc||""}"`);
          ls.push(`- Modify **${n.label}**: ${ch.join(", ")}`);
        });
        addedE.forEach(e=>ls.push(`- Add connection: ${e.fromLabel} ${e.bidir?"↔":"→"} ${e.toLabel}${e.label?" ("+e.label+")":""}`));
        removedE.forEach(e=>ls.push(`- Remove connection: ${e.fromLabel} ${e.bidir?"↔":"→"} ${e.toLabel}${e.label?" ("+e.label+")":""}`));
        return ls;
      }).join("\n"):"(no changes from AI baseline)";
      scenarioSpecific=`## Current Architecture\n\n${baseList}\n\n## Changes Required\n\n${changeLines}\n\nImplement all listed changes. Preserve everything not mentioned.\n\n`;
    }

    const scenarioLabel=scenario==="new"?"New Project":"Update Existing";
    const contextLine=scenario==="new"
      ? `Build ${promptTitle} from scratch following the architecture below.`
      : `Update ${promptTitle} to implement the changes described below.`;

    setPromptTxt(
      `# ${promptTitle} — Implementation Plan\n\n` +
      `## Context\n\n${contextLine}\n\n` +
      `## Scenario: ${scenarioLabel}\n\n` +
      scenarioSpecific +
      `## Architecture Overview\n\n` +
      allNodes.map(n=>`- **${n.label}** [${NODE_TYPES[n.type]?.promptRole||n.type}]${n.desc?": "+n.desc:""}`).join("\n") +
      `\n\n${entrySection}${stepsSection}${errorSection}${flowSection}`
    );
    setPanel("prompt");
  };
  ```

- [ ] **Step 4: Add editable title field in the Prompt tab UI**

  Find the Prompt tab block (around line 1247):
  ```jsx
  {panel==="prompt"&&(<>
    <Label>claude code prompt</Label>
    {!promptTxt
  ```
  Replace with:
  ```jsx
  {panel==="prompt"&&(<>
    <Label>project name</Label>
    <input value={promptTitle} onChange={e=>setPromptTitle(e.target.value)} placeholder="Untitled Project" style={IS}/>
    <HR/>
    <Label>claude code prompt</Label>
    {!promptTxt
  ```
  (The rest of the block — the `!promptTxt` branch with copy button and textarea — stays unchanged.)

- [ ] **Step 5: Verify in browser**

  - Click "generate prompt →" on the default diagram → Prompt tab shows:
    - Editable "project name" field (Untitled Project)
    - `# Untitled Project — Implementation Plan`
    - `## Scenario: New Project`
    - `## Project Structure` with suggested directory layout
    - `## Architecture Overview` with all nodes
    - `## Implementation Steps` with topologically ordered steps
    - `## Data Flow Summary`
  - Add a **Trigger** node connected to a **Process** → Entry Points section appears.
  - Add a **Decision** node with two outgoing edges labeled "yes" / "no" → Step shows condition branches.
  - Add **Process → Error Handler** with onError edge → Error Handling section appears.
  - Switch scenario to "Update Existing" → prompt shows Current Architecture + Changes Required sections.
  - Load a project folder then edit a node → Update Existing scenario shows the diff in Changes Required.

- [ ] **Step 6: Commit**

  ```bash
  git add src/App.jsx
  git commit -m "feat: rewrite prompt engine with scenarios, topoSort, new node serialization"
  ```

---

## Self-Review Checklist

After all tasks are complete, verify the following:

**Spec coverage:**
- [x] NODE_TYPES registry with all 9 types — Task 1
- [x] Decision diamond shape — Task 2
- [x] Loop rect + ↻ icon + iterate-over subtitle — Task 2
- [x] Trigger rounded + category badge — Task 2
- [x] Error Handler dashed red border + ⚠ — Task 2
- [x] onError edge (red dashed, ⚠ onError label, error-node-only validation) — Task 3
- [x] Properties panel: generic fields from NODE_TYPES.fields — Task 4
- [x] Properties panel: Decision hint — Task 4
- [x] Properties panel: Loop/Error enter-body button — Task 4
- [x] Properties panel: ON ERROR section on all nodes — Task 4
- [x] Grouped Add Node dropdown — Task 5
- [x] Topbar scenario control (auto + override) — Task 6
- [x] Editable project name in Prompt tab — Task 7
- [x] topoSort for step ordering — Task 7
- [x] Entry Points section (trigger nodes) — Task 7
- [x] Implementation Steps with decision branches, loop iterations — Task 7
- [x] Error Handling section — Task 7
- [x] Data Flow Summary — Task 7
- [x] New Project scenario-specific sections — Task 7
- [x] Update Existing scenario-specific sections (diff from AI baseline) — Task 7

**Type consistency:** `NODE_TYPES[type].fields[].key` values (`iterateOver`, `triggerType`, `triggerDetail`) are used consistently across: props panel field rendering (Task 4), node canvas rendering (Task 2, subtitle), and prompt serialization (Task 7).
