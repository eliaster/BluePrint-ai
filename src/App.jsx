import { useState, useRef, useCallback, useEffect } from "react";

// ── constants ────────────────────────────────────────────────────────────────
const NW = 200, NH = 72, G = 24;
const uid  = () => Math.random().toString(36).slice(2, 10);
const snap = v  => Math.round(v / G) * G;

const NT = {
  process:  { label: "Process"    },
  data:     { label: "Data Store" },
  api:      { label: "API"        },
  ui:       { label: "UI Layer"   },
  external: { label: "External"   },
};
const MODES = [
  { id:"SELECT",   icon:"↖", label:"Select"  },
  { id:"ADD_NODE", icon:"+",  label:"Add node"},
  { id:"ADD_EDGE", icon:"→",  label:"Connect" },
  { id:"DELETE",   icon:"×",  label:"Delete"  },
];
const LAYOUT_OPTIONS = [
  { id:"auto",   label:"auto-detect"    },
  { id:"lr",     label:"left → right"   },
  { id:"tb",     label:"top → bottom"   },
  { id:"radial", label:"radial"          },
  { id:"force",  label:"force-directed"  },
];
const RELEVANT = /\.(js|ts|jsx|tsx|py|go|rs|java|rb|c|cpp|h|cs|swift|kt|json|yaml|yml|toml|md)$/i;
const SKIP     = /node_modules|\.git|dist|build|\.next|__pycache__|vendor|\.cache|coverage/i;
const MAX_FILES = 18, MAX_CHARS = 2800;

const PROVIDERS = [
  { id:"anthropic", label:"Anthropic",      hasKey:true,  hasUrl:false, defaultModel:"claude-sonnet-4-5",     urlPlaceholder:"" },
  { id:"openai",    label:"OpenAI",          hasKey:true,  hasUrl:false, defaultModel:"gpt-4o",                urlPlaceholder:"" },
  { id:"ollama",    label:"Ollama (local)",  hasKey:false, hasUrl:true,  defaultModel:"llama3.2",              urlPlaceholder:"http://localhost:11434" },
  { id:"custom",    label:"Custom (OpenAI-compatible)", hasKey:true, hasUrl:true, defaultModel:"", urlPlaceholder:"http://localhost:8080" },
];

const SYSTEM_PROMPT = `You are a professional software architect. Analyze the provided input and output a technical system diagram.
RETURN ONLY A RAW JSON OBJECT. DO NOT USE MARKDOWN CODE FENCES (\`\`\`), PREAMBLES, OR EXPLANATIONS.
{
  "nodes": [
    {
      "id": "n1", 
      "label": "Title Case Label", 
      "type": "process|data|api|ui|external", 
      "desc": "Short technical description", 
      "x": 100, 
      "y": 150,
      "children": {
        "nodes": [
          {"id": "n1_1", "label": "Internal Module", "type": "process", "desc": "Internal detail", "x": 100, "y": 150}
        ],
        "edges": [
          {"id": "e_sub1", "from": "n1_1", "to": "n1_2", "label": "Internal Flow", "bidir": false}
        ]
      }
    }
  ],
  "edges": [
    {"id": "e1", "from": "n1", "to": "n2", "label": "Action/Data Flow", "bidir": false}
  ]
}
CONSTRAINTS:
Nodes: 6-14 total at the root level.
Nesting: Use the "children" property to generate sub-boxes (nested diagrams) ONLY for complex modules, macro-services, or distinct domains that require internal detailing. Leave "children" out for simple nodes.
Edges: 5-16 total per level.
Canvas: x: [80, 1280], y: [80, 520] (applies independently to each nested level).
Text: Labels < 4 words (Title Case). Descriptions < 8 words.
Logic: Ensure a logical flow (Entry -> Controller/Logic -> Data Store -> External API).
Spatiality: Place entry points on the left (low x) and external systems on the right (high x).`;


function loadSettings() {
  try { return JSON.parse(localStorage.getItem("bp_settings") || "{}"); } catch { return {}; }
}
function defaultSettings() {
  return { provider:"anthropic", model:"claude-sonnet-4-5", baseUrl:"", apiKeys:{anthropic:"",openai:"",ollama:"",custom:""} };
}

// ── ports ─────────────────────────────────────────────────────────────────────
const PORT_TYPES = ["any","string","number","boolean","object","array","stream","binary"];
const PORT_COLORS = {
  any:"#8a8880", string:"#5a7a5a", number:"#5a5a8a", boolean:"#8a5a5a",
  object:"#7a5a8a", array:"#5a7a8a", stream:"#8a7a5a", binary:"#6a6a6a",
};

const portY = (i, total) => Math.max(20, NH * (i + 1) / (total + 1));

function portPos(node, portId, side) {
  const arr = side === "output" ? (node.outputs||[]) : (node.inputs||[]);
  const idx = arr.findIndex(p => p.id === portId);
  if (idx < 0) return null;
  return { x: node.x + (side === "output" ? NW : 0), y: node.y + portY(idx, arr.length) };
}

// ── diagram helpers ───────────────────────────────────────────────────────────
function mkNode(label="Node", x=200, y=200, type="process") {
  return { id:uid(), label, x, y, type, desc:"", inputs:[], outputs:[] };
}
function mkEdge(from, to, label="", fromPort=null, toPort=null) {
  return { id:uid(), from, to, label, bidir:false, fromPort, toPort };
}
function edgePts(a, b) {
  const ax=a.x+NW/2, ay=a.y+NH/2, bx=b.x+NW/2, by=b.y+NH/2;
  const dx=bx-ax, dy=by-ay, len=Math.hypot(dx,dy)||1;
  const nx=dx/len, ny=dy/len;
  const clip=(cx,cy,sdx,sdy)=>{
    const s=Math.min((NW/2+8)/Math.abs(sdx||1e-9),(NH/2+8)/Math.abs(sdy||1e-9),len/2-6);
    return {x:cx+sdx*s, y:cy+sdy*s};
  };
  const p1=clip(ax,ay,nx,ny), p2=clip(bx,by,-nx,-ny);
  return {x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,mx:(p1.x+p2.x)/2,my:(p1.y+p2.y)/2};
}

// ── edge routing ─────────────────────────────────────────────────────────────
const EDGE_STYLES = [
  {id:"bezier",     label:"curve"},
  {id:"orthogonal", label:"corner"},
  {id:"straight",   label:"straight"},
];

function computeEdgePath(x1, y1, x2, y2, style, allNodes, fromId, toId) {
  const PAD = 10;
  if (style === "bezier") {
    const cp = Math.max(Math.abs(x2 - x1) * 0.5, 60);
    let cp1y = y1, cp2y = y2;
    const approxMidX = (x1 + x2) / 2;
    const approxMidY = (y1 + y2) / 2;
    for (const n of allNodes) {
      if (n.id === fromId || n.id === toId) continue;
      if (approxMidX > n.x - PAD && approxMidX < n.x + NW + PAD &&
          approxMidY > n.y - PAD && approxMidY < n.y + NH + PAD) {
        const deflect = NH + PAD + 20;
        cp1y = y1 - deflect; cp2y = y2 - deflect;
        break;
      }
    }
    const mx = 0.125*x1 + 0.375*(x1+cp) + 0.375*(x2-cp) + 0.125*x2;
    const my = 0.125*y1 + 0.375*cp1y + 0.375*cp2y + 0.125*y2;
    return {path:`M${x1},${y1} C${x1+cp},${cp1y} ${x2-cp},${cp2y} ${x2},${y2}`, mx, my};
  }
  if (style === "orthogonal") {
    let midX = (x1 + x2) / 2;
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    for (const n of allNodes) {
      if (n.id === fromId || n.id === toId) continue;
      if (midX > n.x - PAD && midX < n.x + NW + PAD &&
          minY < n.y + NH + PAD && maxY > n.y - PAD) {
        midX = n.x + NW + PAD + 16; break;
      }
    }
    return {path:`M${x1},${y1} H${midX} V${y2} H${x2}`, mx:midX, my:(y1+y2)/2};
  }
  return {path:`M${x1},${y1} L${x2},${y2}`, mx:(x1+x2)/2, my:(y1+y2)/2};
}

function selfLoopPath(node) {
  const cx = node.x + NW / 2;
  const top = node.y;
  return {
    path: `M${cx-18},${top} C${cx-56},${top-78} ${cx+56},${top-78} ${cx+18},${top}`,
    mx: cx, my: top - 58,
  };
}

// ── layout algorithms ─────────────────────────────────────────────────────────

function detectLayout(nodes, edges) {
  if (nodes.length <= 3) return "lr";
  const inDeg={}, outDeg={};
  nodes.forEach(n=>{ inDeg[n.id]=0; outDeg[n.id]=0; });
  edges.forEach(e=>{ inDeg[e.to]=(inDeg[e.to]||0)+1; outDeg[e.from]=(outDeg[e.from]||0)+1; });
  const maxDeg = Math.max(...nodes.map(n=>(inDeg[n.id]||0)+(outDeg[n.id]||0)));
  const roots  = nodes.filter(n=>inDeg[n.id]===0).length;
  const density= edges.length / Math.max(nodes.length,1);
  if (maxDeg >= nodes.length * 0.45) return "radial";
  if (density > 2.2)                 return "force";
  if (roots >= 3)                    return "tb";
  return "lr";
}

function assignLayers(nodes, edges) {
  const outAdj={}, inAdj={};
  nodes.forEach(n=>{ outAdj[n.id]=[]; inAdj[n.id]=[]; });
  edges.forEach(e=>{
    if(outAdj[e.from]&&inAdj[e.to]){ outAdj[e.from].push(e.to); inAdj[e.to].push(e.from); }
  });
  const color={};
  nodes.forEach(n=>color[n.id]=0);
  const backEdges=new Set();
  function dfs(id){
    color[id]=1;
    for(const nb of outAdj[id]){
      if(color[nb]===1) backEdges.add(id+"->"+nb);
      else if(color[nb]===0) dfs(nb);
    }
    color[id]=2;
  }
  nodes.forEach(n=>{ if(!color[n.id]) dfs(n.id); });
  backEdges.forEach(be=>{
    const [f,t]=be.split("->");
    outAdj[f]=outAdj[f].filter(x=>x!==t);
    inAdj[t] =inAdj[t].filter(x=>x!==f);
  });
  const layer={};
  const computed=new Set();
  function getL(id){
    if(computed.has(id)) return layer[id];
    computed.add(id);
    const preds=inAdj[id];
    layer[id]=preds.length===0 ? 0 : Math.max(...preds.map(p=>getL(p)+1));
    return layer[id];
  }
  nodes.forEach(n=>getL(n.id));
  return {layer, outAdj, inAdj};
}

function reduceCrossings(layerGroups, inAdj, outAdj, maxLayer) {
  const groups = {};
  for(let i=0;i<=maxLayer;i++) groups[i]=[...layerGroups[i]];
  for(let pass=0;pass<4;pass++){
    for(let l=1;l<=maxLayer;l++){
      const prevPos={};
      groups[l-1].forEach((id,i)=>prevPos[id]=i);
      groups[l].sort((a,b)=>{
        const pA=inAdj[a].filter(p=>prevPos[p]!==undefined);
        const pB=inAdj[b].filter(p=>prevPos[p]!==undefined);
        const bA=pA.length?pA.reduce((s,p)=>s+prevPos[p],0)/pA.length:999;
        const bB=pB.length?pB.reduce((s,p)=>s+prevPos[p],0)/pB.length:999;
        return bA-bB;
      });
    }
    for(let l=maxLayer-1;l>=0;l--){
      const nextPos={};
      groups[l+1].forEach((id,i)=>nextPos[id]=i);
      groups[l].sort((a,b)=>{
        const sA=outAdj[a].filter(s=>nextPos[s]!==undefined);
        const sB=outAdj[b].filter(s=>nextPos[s]!==undefined);
        const bA=sA.length?sA.reduce((s,p)=>s+nextPos[p],0)/sA.length:999;
        const bB=sB.length?sB.reduce((s,p)=>s+nextPos[p],0)/sB.length:999;
        return bA-bB;
      });
    }
  }
  return groups;
}

const HGAP = 60;
const VGAP = 48;
const SLOT_W = NW + HGAP;
const SLOT_H = NH + VGAP;

function deOverlap(positions, nodeIds) {
  const pos = {...positions};
  for(let pass=0;pass<5;pass++){
    let moved=false;
    for(let i=0;i<nodeIds.length;i++){
      for(let j=i+1;j<nodeIds.length;j++){
        const a=nodeIds[i], b=nodeIds[j];
        const dx=pos[b].x-pos[a].x, dy=pos[b].y-pos[a].y;
        const overX=SLOT_W-Math.abs(dx), overY=SLOT_H-Math.abs(dy);
        if(overX>0&&overY>0){
          if(overX<overY){
            const shift=(overX/2+2)*(dx>=0?1:-1);
            pos[a].x=snap(pos[a].x-shift); pos[b].x=snap(pos[b].x+shift);
          } else {
            const shift=(overY/2+2)*(dy>=0?1:-1);
            pos[a].y=snap(pos[a].y-shift); pos[b].y=snap(pos[b].y+shift);
          }
          moved=true;
        }
      }
    }
    if(!moved)break;
  }
  return pos;
}

function layeredLayout(nodes, edges, dir="lr") {
  if(!nodes.length) return {};
  const {layer, outAdj, inAdj} = assignLayers(nodes, edges);
  const maxLayer = Math.max(...Object.values(layer));
  const layerGroups={};
  for(let i=0;i<=maxLayer;i++) layerGroups[i]=[];
  nodes.forEach(n=>layerGroups[layer[n.id]||0].push(n.id));
  const sorted = reduceCrossings(layerGroups, inAdj, outAdj, maxLayer);

  const positions = {};

  if(dir==="lr"){
    Object.entries(sorted).forEach(([l,ids])=>{
      const x = 80 + (+l) * (NW + HGAP + 40);
      const totalH = ids.length * SLOT_H;
      const startY = Math.max(60, 300 - totalH/2);
      ids.forEach((id,i)=>{
        positions[id]={x:snap(x), y:snap(startY + i*SLOT_H)};
      });
    });
  } else {
    const rowPitch = NH + VGAP + 30;
    Object.entries(sorted).forEach(([l,ids])=>{
      const y = 80 + (+l) * rowPitch;
      const totalW = ids.length * SLOT_W;
      const startX = Math.max(60, 640 - totalW/2);
      ids.forEach((id,i)=>{
        positions[id]={x:snap(startX + i*SLOT_W), y:snap(y)};
      });
    });
  }

  return deOverlap(positions, nodes.map(n=>n.id));
}

function radialLayout(nodes, edges) {
  if(!nodes.length) return {};
  const deg={};
  nodes.forEach(n=>deg[n.id]=0);
  edges.forEach(e=>{ deg[e.from]=(deg[e.from]||0)+1; deg[e.to]=(deg[e.to]||0)+1; });
  const center=nodes.reduce((a,b)=>deg[a.id]>=deg[b.id]?a:b);

  const adj={};
  nodes.forEach(n=>adj[n.id]=new Set());
  edges.forEach(e=>{ adj[e.from].add(e.to); adj[e.to].add(e.from); });
  const dist={[center.id]:0}, parent={};
  const q=[center.id];
  while(q.length){
    const cur=q.shift();
    for(const nb of adj[cur]){
      if(dist[nb]===undefined){ dist[nb]=dist[cur]+1; parent[nb]=cur; q.push(nb); }
    }
  }
  nodes.forEach(n=>{ if(dist[n.id]===undefined) dist[n.id]=1; });

  const rings={};
  nodes.forEach(n=>{ const d=dist[n.id]; if(!rings[d])rings[d]=[]; rings[d].push(n.id); });

  const cx=680, cy=300;
  const diag = Math.hypot(NW, NH);
  const getR = (d, count) => {
    if(d===0) return 0;
    const minR = (count * (diag + HGAP)) / (2*Math.PI);
    const baseR = 80 + d * (diag + 60);
    return Math.max(minR, baseR);
  };

  const positions={};
  positions[center.id]={x:snap(cx-NW/2), y:snap(cy-NH/2)};

  Object.entries(rings).forEach(([d,ids])=>{
    if(+d===0) return;
    const r = getR(+d, ids.length);
    ids.sort((a,b)=>{
      const pa=positions[parent[a]], pb=positions[parent[b]];
      if(!pa||!pb) return 0;
      return Math.atan2(pa.y+NH/2-cy, pa.x+NW/2-cx) - Math.atan2(pb.y+NH/2-cy, pb.x+NW/2-cx);
    });
    ids.forEach((id,i)=>{
      const angle = -Math.PI/2 + (2*Math.PI*i/ids.length);
      positions[id]={x:snap(cx+r*Math.cos(angle)-NW/2), y:snap(cy+r*Math.sin(angle)-NH/2)};
    });
  });

  return deOverlap(positions, nodes.map(n=>n.id));
}

function forceLayout(nodes, edges) {
  if(!nodes.length) return {};
  const N=nodes.length;
  const pos={}, vel={};
  const cols=Math.ceil(Math.sqrt(N));
  nodes.forEach((n,i)=>{
    pos[n.id]={x:100+(i%cols)*SLOT_W, y:80+Math.floor(i/cols)*SLOT_H};
    vel[n.id]={x:0, y:0};
  });

  const IDEAL = Math.hypot(SLOT_W, SLOT_H) * 1.1;
  const REPEL = SLOT_W * SLOT_H * 18;
  const ATTRACT = 0.22, DAMP = 0.5, ITERS = 180;

  for(let it=0;it<ITERS;it++){
    const cool = 1 - it/ITERS;
    const F={};
    nodes.forEach(n=>F[n.id]={x:0,y:0});
    for(let i=0;i<nodes.length;i++){
      for(let j=i+1;j<nodes.length;j++){
        const a=nodes[i], b=nodes[j];
        const dx=(pos[a.id].x+NW/2)-(pos[b.id].x+NW/2);
        const dy=(pos[a.id].y+NH/2)-(pos[b.id].y+NH/2);
        const d=Math.hypot(dx,dy)||1;
        const f=REPEL/(d*d);
        F[a.id].x+=(dx/d)*f; F[a.id].y+=(dy/d)*f;
        F[b.id].x-=(dx/d)*f; F[b.id].y-=(dy/d)*f;
      }
    }
    edges.forEach(e=>{
      if(!pos[e.from]||!pos[e.to]) return;
      const dx=(pos[e.to].x+NW/2)-(pos[e.from].x+NW/2);
      const dy=(pos[e.to].y+NH/2)-(pos[e.from].y+NH/2);
      const d=Math.hypot(dx,dy)||1;
      const f=ATTRACT*(d-IDEAL)/d;
      F[e.from].x+=dx*f; F[e.from].y+=dy*f;
      F[e.to].x  -=dx*f; F[e.to].y  -=dy*f;
    });
    nodes.forEach(n=>{
      vel[n.id].x=(vel[n.id].x+F[n.id].x)*DAMP*cool;
      vel[n.id].y=(vel[n.id].y+F[n.id].y)*DAMP*cool;
      pos[n.id].x+=vel[n.id].x;
      pos[n.id].y+=vel[n.id].y;
    });
  }

  const xs=nodes.map(n=>pos[n.id].x), ys=nodes.map(n=>pos[n.id].y);
  const mnX=Math.min(...xs), mxX=Math.max(...xs)+NW;
  const mnY=Math.min(...ys), mxY=Math.max(...ys)+NH;
  const scX=mxX>mnX ? (1180-80)/(mxX-mnX) : 1;
  const scY=mxY>mnY ? (520-80) /(mxY-mnY) : 1;
  const sc=Math.min(scX,scY,1.0);
  const positions={};
  nodes.forEach(n=>positions[n.id]={
    x:snap(80+(pos[n.id].x-mnX)*sc),
    y:snap(80+(pos[n.id].y-mnY)*sc),
  });
  return deOverlap(positions, nodes.map(n=>n.id));
}

function computeLayout(nodes, edges, type) {
  switch(type){
    case "lr":     return layeredLayout(nodes,edges,"lr");
    case "tb":     return layeredLayout(nodes,edges,"tb");
    case "radial": return radialLayout(nodes,edges);
    case "force":  return forceLayout(nodes,edges);
    default:       return layeredLayout(nodes,edges,"lr");
  }
}

function applyPositions(nodes, positions) {
  return nodes.map(n => positions[n.id] ? {...n,...positions[n.id]} : n);
}

// ── nested diagram helpers ────────────────────────────────────────────────────
function getDiagramAtPath(root, navPath) {
  let level = root;
  for (const {nodeId} of navPath) {
    const node = level.nodes.find(n => n.id === nodeId);
    if (!node) return {nodes:[], edges:[]};
    level = node.children || {nodes:[], edges:[]};
  }
  return level;
}

function updateAtPath(root, navPath, newLevel) {
  if (!navPath.length) return newLevel;
  const [head, ...rest] = navPath;
  return {
    ...root,
    nodes: root.nodes.map(n =>
      n.id === head.nodeId
        ? {...n, children: rest.length
            ? updateAtPath(n.children || {nodes:[],edges:[]}, rest, newLevel)
            : newLevel}
        : n
    )
  };
}

// ── default diagram ───────────────────────────────────────────────────────────
const DN = [
  mkNode("Client",       80,  180, "ui"      ),
  mkNode("API Gateway",  380, 180, "api"     ),
  mkNode("Auth",         660, 80,  "process" ),
  mkNode("Core Service", 660, 280, "process" ),
  mkNode("Database",     940, 180, "data"    ),
  mkNode("External API", 940, 370, "external"),
];
const [n0,n1,n2,n3,n4,n5]=DN;
const DE=[
  mkEdge(n0.id,n1.id,"HTTP"),    mkEdge(n1.id,n2.id,"auth"),
  mkEdge(n1.id,n3.id,"route"),   mkEdge(n3.id,n4.id,"read/write"),
  mkEdge(n3.id,n5.id,"3rd-party"),mkEdge(n2.id,n4.id,"user store"),
];

// ── palette & styles ──────────────────────────────────────────────────────────
const P={cream:"#f7f5ee",paper:"#fdfcf8",ink:"#1c1b17",dim:"#8a8880",faint:"#d4d1c6",grid:"#e4e1d8",danger:"#a83228"};
const IS={display:"block",width:"100%",marginTop:3,background:"transparent",border:"1px solid #d4d1c6",borderRadius:0,padding:"5px 8px",color:"#1c1b17",fontSize:11,fontFamily:"'Courier New',monospace",boxSizing:"border-box",outline:"none"};
const BS=(active,danger)=>({padding:"4px 10px",borderRadius:0,cursor:"pointer",fontSize:11,fontFamily:"'Courier Prime',monospace",background:"transparent",border:`1px solid ${danger?"#a83228":active?"#1c1b17":"#d4d1c6"}`,color:danger?"#a83228":active?"#1c1b17":"#8a8880"});

// ── file helpers ──────────────────────────────────────────────────────────────
function scoreFile(p){
  const n=p.split("/").pop();
  if(/^(README|package\.json|Cargo\.toml|go\.mod|pyproject\.toml|setup\.py|main\.|index\.|app\.|mod\.rs)/.test(n))return 0;
  if(p.split("/").length===2)return 1;
  if(/\/(src|lib|core|app|cmd|pkg|internal)\//.test(p))return 2;
  if(/\/(test|spec|__test__)\//.test(p))return 9;
  return 3;
}
function readFile(file){
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsText(file,"utf-8");});
}

async function analyzeLocalFiles(files, setStatus, settings){
  const {provider, model, apiKeys, baseUrl} = settings;
  const relevant=[...files].filter(f=>RELEVANT.test(f.name)&&!SKIP.test(f.webkitRelativePath||f.name))
    .sort((a,b)=>scoreFile(a.webkitRelativePath||a.name)-scoreFile(b.webkitRelativePath||b.name)).slice(0,MAX_FILES);
  if(!relevant.length) throw new Error("No supported source files found.");
  setStatus(`reading ${relevant.length} files…`);
  const chunks=await Promise.all(relevant.map(async f=>{
    try{const t=await readFile(f);return `=== ${f.webkitRelativePath||f.name} ===\n${t.slice(0,MAX_CHARS)}`;}catch{return null;}
  }));
  const corpus=chunks.filter(Boolean).join("\n\n");
  const projectName=relevant[0]?.webkitRelativePath?.split("/")[0]||"project";
  const apiKey = apiKeys[provider] || "";

  let url, headers, body, parseResponse;

  if(provider==="anthropic"){
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "Content-Type":"application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    body = { model, max_tokens:2000, system:SYSTEM_PROMPT,
      messages:[{role:"user",content:`Project: ${projectName}\n\n${corpus}`}] };
    parseResponse = d => {
      if(d.error) throw new Error(d.error.message);
      return (d.content||[]).filter(b=>b.type==="text").slice(-1)[0]?.text || "";
    };
  } else {
    const base = provider==="openai"  ? "https://api.openai.com"
               : provider==="ollama"  ? (baseUrl||"http://localhost:11434")
               : (baseUrl||"");
    if(!base) throw new Error("Base URL required for custom provider.");
    url = `${base}/v1/chat/completions`;
    headers = {"Content-Type":"application/json"};
    if(apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    body = { model, max_tokens:2000,
      messages:[{role:"system",content:SYSTEM_PROMPT},{role:"user",content:`Project: ${projectName}\n\n${corpus}`}] };
    parseResponse = d => {
      if(d.error) throw new Error(typeof d.error==="string"?d.error:d.error.message||"API error");
      return d.choices?.[0]?.message?.content || "";
    };
  }

  setStatus(`analysing with ${provider}…`);
  const res=await fetch(url,{method:"POST",headers,body:JSON.stringify(body)});
  if(!res.ok){const t=await res.text().catch(()=>"");throw new Error(`API ${res.status}${t?": "+t.slice(0,120):""}`);}
  const d=await res.json();
  const raw=parseResponse(d).replace(/```json|```/g,"").trim();
  if(!raw)throw new Error("Empty response — try again");
  const match=raw.match(/\{[\s\S]*\}/);
  if(!match)throw new Error("Could not parse JSON from response");
  return JSON.parse(match[0]);
}

// ── helpers ───────────────────────────────────────────────────────────────────
function Label({children}){return <div style={{fontSize:9,fontWeight:700,letterSpacing:1.8,color:"#8a8880",marginTop:4}}>{children}</div>;}
function HR(){return <div style={{borderTop:"1px solid #e4e1d8",margin:"4px 0"}}/>;}

// ── main ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [rootDiagram,setRootDiagram] = useState({nodes:DN, edges:DE});
  const [navPath,setNavPath]   = useState([]);
  const [mode,setMode]         = useState("SELECT");
  const [newType,setNewType]   = useState("process");
  const [sel,setSel]           = useState(null);
  const [edgeSrc,setEdgeSrc]   = useState(null);
  const [edgeSrcPort,setEdgeSrcPort] = useState(null); // {portId, portType} | null
  const [drag,setDrag]         = useState(null);
  const [panSt,setPanSt]       = useState(null);
  const [pan,setPan]           = useState({x:60,y:60});
  const [zoom,setZoom]         = useState(0.84);
  const [busy,setBusy]         = useState(false);
  const [status,setStatus]     = useState("");
  const [err,setErr]           = useState("");
  const [fileInfo,setFileInfo] = useState(null);
  const [promptTxt,setPromptTxt]=useState("");
  const [copied,setCopied]     = useState(false);
  const [panel,setPanel]       = useState("files");
  const [dragging,setDragging] = useState(false);
  const [edgeStyle,setEdgeStyle]       = useState("bezier");
  const [layoutType,setLayoutType]     = useState("auto");
  const [detectedLayout,setDetectedLayout] = useState("lr");
  const [layoutFlash,setLayoutFlash]   = useState(false);
  const [settings,setSettings] = useState(()=>({...defaultSettings(),...loadSettings()}));

  // Derived current level (re-computed on every render — cheap)
  const currentLevel = getDiagramAtPath(rootDiagram, navPath);
  const nodes = currentLevel.nodes;
  const edges = currentLevel.edges;

  // Virtual setters — transparently operate on the current navigation level
  const setNodes = useCallback((updater) => {
    setRootDiagram(prev => {
      const cur = getDiagramAtPath(prev, navPath);
      const next = typeof updater === "function" ? updater(cur.nodes) : updater;
      return updateAtPath(prev, navPath, {...cur, nodes: next});
    });
  }, [navPath]);

  const setEdges = useCallback((updater) => {
    setRootDiagram(prev => {
      const cur = getDiagramAtPath(prev, navPath);
      const next = typeof updater === "function" ? updater(cur.edges) : updater;
      return updateAtPath(prev, navPath, {...cur, edges: next});
    });
  }, [navPath]);

  const svgRef=useRef(null), fileInput=useRef(null), importInput=useRef(null);

  useEffect(()=>{
    if(document.getElementById("bp-font"))return;
    const l=document.createElement("link");
    l.id="bp-font";l.rel="stylesheet";
    l.href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Courier+Prime:ital,wght@0,400;0,700;1,400&display=swap";
    document.head.appendChild(l);
  },[]);

  const saveSettings = (patch) => {
    setSettings(prev => {
      const next = {...prev, ...patch};
      localStorage.setItem("bp_settings", JSON.stringify(next));
      return next;
    });
  };
  const saveApiKey = (key) => saveSettings({apiKeys:{...settings.apiKeys,[settings.provider]:key}});

  const enterNode = useCallback((node) => {
    const z   = 0.84;
    const W   = svgRef.current?.clientWidth  || 900;
    const H   = svgRef.current?.clientHeight || 600;
    const rowH = NH + 48;

    // boundary nodes straddle the canvas edge: 40% visible, 60% outside
    const inputX  = -NW * 0.6;                    // left wall
    const outputX =  W / z - NW * 0.4;            // right wall
    const centerX =  W / (2 * z) - NW / 2;
    const midY    =  H / (2 * z);

    setRootDiagram(prev => {
      const cur = getDiagramAtPath(prev, navPath);
      const existing = cur.nodes.find(n => n.id === node.id);
      if (existing?.children?.nodes?.length) return prev;

      const inEdges  = cur.edges.filter(e => e.to   === node.id);
      const outEdges = cur.edges.filter(e => e.from === node.id);

      const total  = Math.max(inEdges.length || 1, outEdges.length || 1);
      const startY = midY - ((total - 1) * rowH) / 2 - NH / 2;

      const inputNodes = inEdges.length
        ? inEdges.map((e,i) => {
            const src = cur.nodes.find(n => n.id === e.from);
            return {...mkNode(e.label||src?.label||`in ${i+1}`, inputX, startY+i*rowH, "external"), _boundary:"input"};
          })
        : [{...mkNode("input", inputX, startY, "external"), _boundary:"input"}];

      const outputNodes = outEdges.length
        ? outEdges.map((e,i) => {
            const dst = cur.nodes.find(n => n.id === e.to);
            return {...mkNode(e.label||dst?.label||`out ${i+1}`, outputX, startY+i*rowH, "external"), _boundary:"output"};
          })
        : [{...mkNode("output", outputX, startY, "external"), _boundary:"output"}];

      const centerNode = mkNode(node.label, centerX, midY - NH/2, node.type);
      const newNodes = [...inputNodes, centerNode, ...outputNodes];
      const newEdges = [
        ...inputNodes.map(n => mkEdge(n.id, centerNode.id)),
        ...outputNodes.map(n => mkEdge(centerNode.id, n.id)),
      ];

      const updatedNodes = cur.nodes.map(n =>
        n.id === node.id ? {...n, children:{nodes:newNodes, edges:newEdges}} : n
      );
      return updateAtPath(prev, navPath, {...cur, nodes:updatedNodes});
    });
    setNavPath(p => [...p, {nodeId: node.id, label: node.label}]);
    setSel(null); setEdgeSrc(null); setPan({x:0, y:0}); setZoom(z);
  }, [navPath]);

  const exitToLevel = useCallback((idx) => {
    setNavPath(p => p.slice(0, idx));
    setSel(null); setEdgeSrc(null); setPan({x:60,y:60}); setZoom(0.84);
  }, []);

  const selNode=sel?.k==="node"?nodes.find(n=>n.id===sel.id):null;
  const selEdge=sel?.k==="edge"?edges.find(e=>e.id===sel.id):null;
  useEffect(()=>{if(sel)setPanel("props");},[sel]);

  const updNode=(id,p)=>setNodes(ns=>ns.map(n=>n.id===id?{...n,...p}:n));
  const updEdge=(id,p)=>setEdges(es=>es.map(e=>e.id===id?{...e,...p}:e));

  // ── layout ──────────────────────────────────────────────────────────────────
  const runLayout = useCallback((type, ns, es) => {
    const src=ns||nodes, srcE=es||edges;
    const effective=(type||layoutType)==="auto"?detectLayout(src,srcE):(type||layoutType);
    setDetectedLayout(effective);
    const pos=computeLayout(src,srcE,effective);
    return applyPositions(src,pos);
  }, [nodes,edges,layoutType]);

  const applyLayout = useCallback((type) => {
    const positioned=runLayout(type);
    setNodes(positioned);
    setLayoutFlash(true);
    setTimeout(()=>setLayoutFlash(false),600);
    setPan({x:60,y:60}); setZoom(0.84);
  }, [runLayout]);

  // ── SVG / interaction ────────────────────────────────────────────────────────
  const toSvg=useCallback((e)=>{
    const r=svgRef.current.getBoundingClientRect();
    return {x:(e.clientX-r.left-pan.x)/zoom, y:(e.clientY-r.top-pan.y)/zoom};
  },[pan,zoom]);

  const onNodeDown=useCallback((e,id)=>{
    e.stopPropagation();
    if(mode==="DELETE"){setNodes(ns=>ns.filter(n=>n.id!==id));setEdges(es=>es.filter(e=>e.from!==id&&e.to!==id));if(sel?.id===id)setSel(null);return;}
    if(mode==="ADD_EDGE"){
      if(!edgeSrc){setEdgeSrc(id);setEdgeSrcPort(null);return;}
      if(edgeSrc!==id) setEdges(es=>[...es,mkEdge(edgeSrc,id,"",edgeSrcPort?.portId||null,null)]);
      else             setEdges(es=>[...es,mkEdge(id,id,"")]);
      setEdgeSrc(null);setEdgeSrcPort(null);setMode("SELECT");
      return;
    }
    setSel({k:"node",id});
    const node=nodes.find(n=>n.id===id), pt=toSvg(e);
    setDrag({id,ox:pt.x-node.x,oy:pt.y-node.y});
  },[mode,edgeSrc,edgeSrcPort,nodes,sel,toSvg]);

  const onPortDown=useCallback((e, nodeId, portId, portType, side)=>{
    e.stopPropagation();
    if(mode!=="ADD_EDGE") return;
    if(!edgeSrc){
      if(side!=="output") return; // can only start from an output
      setEdgeSrc(nodeId); setEdgeSrcPort({portId, portType});
    } else {
      if(edgeSrc===nodeId) return;
      const fromPortId = edgeSrcPort?.portId||null;
      const toPortId   = side==="input" ? portId : null;
      // warn on type mismatch but still connect
      const srcT=edgeSrcPort?.portType, dstT=portType;
      if(srcT&&dstT&&srcT!=="any"&&dstT!=="any"&&srcT!==dstT){
        setErr(`Type hint: ${srcT} → ${dstT} (may be incompatible)`);
        setTimeout(()=>setErr(""),3000);
      }
      setEdges(es=>[...es, mkEdge(edgeSrc, nodeId, "", fromPortId, toPortId)]);
      setEdgeSrc(null); setEdgeSrcPort(null); setMode("SELECT");
    }
  },[mode,edgeSrc,edgeSrcPort,setEdges]);

  const onCanvasDown=useCallback((e)=>{
    if(mode==="ADD_NODE"){const pt=toSvg(e);const n=mkNode("New node",snap(pt.x-NW/2),snap(pt.y-NH/2),newType);setNodes(ns=>[...ns,n]);setSel({k:"node",id:n.id});setMode("SELECT");return;}
    setSel(null);setEdgeSrc(null);
    setPanSt({sx:e.clientX,sy:e.clientY,spx:pan.x,spy:pan.y});
  },[mode,toSvg,newType,pan]);

  const onMove=useCallback((e)=>{
    if(drag){const pt=toSvg(e);setNodes(ns=>ns.map(n=>n.id===drag.id?{...n,x:snap(pt.x-drag.ox),y:snap(pt.y-drag.oy)}:n));}
    if(panSt)setPan({x:panSt.spx+e.clientX-panSt.sx,y:panSt.spy+e.clientY-panSt.sy});
  },[drag,panSt,toSvg]);

  const onUp=useCallback(()=>{setDrag(null);setPanSt(null);},[]);

  const onEdgeClick=useCallback((e,id)=>{
    e.stopPropagation();
    if(mode==="DELETE"){setEdges(es=>es.filter(x=>x.id!==id));return;}
    setSel({k:"edge",id});
  },[mode]);

  useEffect(()=>{
    const el=svgRef.current;if(!el)return;
    const fn=(e)=>{
      e.preventDefault();const f=e.deltaY>0?0.9:1.11;
      const r=el.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
      setZoom(z=>{const nz=Math.max(.2,Math.min(3,z*f));setPan(p=>({x:mx-(mx-p.x)*nz/z,y:my-(my-p.y)*nz/z}));return nz;});
    };
    el.addEventListener("wheel",fn,{passive:false});
    return()=>el.removeEventListener("wheel",fn);
  },[]);

  // ── file handling ───────────────────────────────────────────────────────────
  const handleFiles=async(files)=>{
    if(!files||!files.length)return;
    const prov=PROVIDERS.find(p=>p.id===settings.provider);
    if(prov?.hasKey && !settings.apiKeys[settings.provider]){setErr("API key required — set it in the Settings tab.");return;}
    if(prov?.hasUrl && settings.provider!=="ollama" && !settings.baseUrl){setErr("Base URL required for custom provider — set it in Settings.");return;}
    const arr=[...files];
    const relevant=arr.filter(f=>RELEVANT.test(f.name)&&!SKIP.test(f.webkitRelativePath||f.name));
    const projectName=arr[0]?.webkitRelativePath?.split("/")[0]||arr[0]?.name||"project";
    setFileInfo({name:projectName,count:relevant.length,total:arr.length});
    setErr("");
    if(!relevant.length){setErr("No supported source files found.");return;}
    setBusy(true);
    try{
      const d=await analyzeLocalFiles(arr,setStatus,settings);
      const newNodes=d.nodes.map(n=>({...n,desc:n.desc||""}));
      const newEdges=d.edges.map(e=>({...e,bidir:e.bidir||false}));
      const effective=detectLayout(newNodes,newEdges);
      setDetectedLayout(effective);
      setLayoutType("auto");
      const pos=computeLayout(newNodes,newEdges,effective);
      setRootDiagram({nodes:applyPositions(newNodes,pos), edges:newEdges});
      setNavPath([]);
      setSel(null);setPan({x:60,y:60});setZoom(0.78);
    }catch(e){setErr(e.message);}
    finally{setBusy(false);setStatus("");}
  };

  const onFileInput=e=>handleFiles(e.target.files);
  const onDrop=e=>{
    e.preventDefault();setDragging(false);
    const files=[];
    const readEntry=(entry,path="")=>new Promise(res=>{
      if(entry.isFile){entry.file(f=>{Object.defineProperty(f,"webkitRelativePath",{value:path+f.name});files.push(f);res();});}
      else if(entry.isDirectory){const r=entry.createReader();const ra=()=>r.readEntries(async entries=>{if(!entries.length)return res();await Promise.all(entries.map(en=>readEntry(en,path+entry.name+"/")));ra();});ra();}
      else res();
    });
    Promise.all([...e.dataTransfer.items].map(item=>{const en=item.webkitGetAsEntry?.();return en?readEntry(en):Promise.resolve();})).then(()=>handleFiles(files));
  };

  // ── export / import JSON ─────────────────────────────────────────────────────
  const exportJSON = () => {
    const data = JSON.stringify(rootDiagram, null, 2);
    const blob = new Blob([data], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "blueprint.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = (e) => {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if(!Array.isArray(parsed.nodes)||!Array.isArray(parsed.edges)) throw new Error("Invalid format");
        setRootDiagram(parsed); setNavPath([]); setSel(null);
        setPan({x:60,y:60}); setZoom(0.84);
        setErr("");
      } catch(err) { setErr("Import failed: "+err.message); }
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  // ── prompt ───────────────────────────────────────────────────────────────────
  const generatePrompt=()=>{
    const renderDiagram=(diagram, depth=0)=>{
      const pad="  ".repeat(depth);
      const nl=diagram.nodes.map(n=>{
        const ins=(n.inputs||[]).map(p=>`${p.name}:${p.type}`).join(", ");
        const outs=(n.outputs||[]).map(p=>`${p.name}:${p.type}`).join(", ");
        const portLine=ins||outs?`\n${pad}  Ports: in(${ins||"—"}) out(${outs||"—"})`:"";
        const childSection=n.children?.nodes?.length
          ? `\n${pad}  Children:\n${renderDiagram(n.children, depth+2)}`
          : "";
        return `${pad}- **${n.label}** [${n.type}]${n.desc?": "+n.desc:""}${portLine}${childSection}`;
      }).join("\n");
      const el=diagram.edges.map(e=>{
        const fn=diagram.nodes.find(n=>n.id===e.from)?.label||"?";
        const tn=diagram.nodes.find(n=>n.id===e.to)?.label||"?";
        return `${pad}  ${fn} ${e.bidir?"↔":"→"} ${tn}${e.label?` (${e.label})`:""}`;
      }).join("\n");
      return [nl,el].filter(Boolean).join("\n");
    };
    setPromptTxt(`# Architecture refactoring blueprint\n\nRestructure the codebase to implement the architecture below exactly.\n\n## Modules / components\n\n${renderDiagram(rootDiagram)}\n\n## Steps\n\n1. Create module/directory structure matching the components above\n2. Implement each with a single clear responsibility matching its type\n3. Wire data flows exactly as specified — no extra coupling\n4. Define clean interfaces at every boundary\n5. Preserve all existing business logic\n6. Add types and annotations throughout\n7. Write unit tests for every new or changed module\n8. Update all imports, exports, dependency declarations\n\nWork from data layer outward: data stores → services → API → UI.\nConfirm each step before proceeding.`);
    setPanel("prompt");
  };

  // ── derived ──────────────────────────────────────────────────────────────────
  const edgeData = edges.map(e => {
    const fn = nodes.find(n => n.id === e.from);
    const tn = nodes.find(n => n.id === e.to);
    if (!fn || !tn) return null;
    if (e.from === e.to) return {...e, ...selfLoopPath(fn), selfLoop:true};
    const fp = e.fromPort ? portPos(fn, e.fromPort, "output") : null;
    const tp = e.toPort   ? portPos(tn, e.toPort,  "input")   : null;
    let x1, y1, x2, y2;
    if (fp && tp) { x1=fp.x; y1=fp.y; x2=tp.x; y2=tp.y; }
    else { const pts=edgePts(fn,tn); x1=pts.x1; y1=pts.y1; x2=pts.x2; y2=pts.y2; }
    const {path, mx, my} = computeEdgePath(x1, y1, x2, y2, edgeStyle, nodes, e.from, e.to);
    return {...e, path, x1, y1, x2, y2, mx, my};
  }).filter(Boolean);
  const cursor=mode==="ADD_NODE"?"crosshair":mode==="DELETE"?"not-allowed":panSt?"grabbing":"default";
  const nodeFill=t=>({process:P.paper,data:"#f0ece0",api:"#f5f2e8",ui:P.paper,external:"#edeadf"}[t]||P.paper);
  const effectiveLabel=LAYOUT_OPTIONS.find(o=>o.id===(layoutType==="auto"?detectedLayout:layoutType))?.label||"";

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100vh",width:"100%",background:P.paper,color:P.ink,fontFamily:"'Courier Prime',monospace",overflow:"hidden",userSelect:"none"}}>
      <style>{`
        *{box-sizing:border-box}
        input,select,textarea{font-family:'Courier Prime',monospace;font-size:11px;color:#1c1b17;outline:none;background:transparent}
        input::placeholder,textarea::placeholder{color:#8a8880}
        input:focus,select:focus,textarea:focus{border-color:#1c1b17!important}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#d4d1c6}
      `}</style>

      {/* ── topbar ──────────────────────────────────────────────────────────── */}
      <div style={{display:"flex",alignItems:"center",height:44,padding:"0 14px",borderBottom:`1px solid ${P.grid}`,flexShrink:0,gap:8,background:P.paper}}>

        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:18,fontStyle:"italic",letterSpacing:"-.1px",lineHeight:1,marginRight:4}}>
          bluePrint
          <span style={{fontStyle:"normal",fontSize:10,fontFamily:"'Courier Prime',monospace",color:P.dim,marginLeft:5,letterSpacing:1}}>STUDIO</span>
        </div>

        {/* modes */}
        <div style={{display:"flex",gap:2}}>
          {MODES.map(m=>(
            <button key={m.id} onClick={()=>{setMode(m.id);if(m.id!=="ADD_EDGE")setEdgeSrc(null);}}
              style={{...BS(mode===m.id),display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:12,lineHeight:1}}>{m.icon}</span><span>{m.label}</span>
            </button>
          ))}
        </div>

        {mode==="ADD_NODE"&&(
          <select value={newType} onChange={e=>setNewType(e.target.value)}
            style={{...IS,width:"auto",marginTop:0,padding:"3px 7px"}}>
            {Object.entries(NT).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
          </select>
        )}

        <div style={{width:1,height:20,background:P.faint,margin:"0 2px"}}/>
        <div style={{display:"flex",gap:2}}>
          {EDGE_STYLES.map(s=>(
            <button key={s.id} onClick={()=>setEdgeStyle(s.id)}
              style={{...BS(edgeStyle===s.id),padding:"4px 8px",fontSize:10}}>
              {s.label}
            </button>
          ))}
        </div>

        <div style={{flex:1}}/>

        <span style={{fontSize:10,color:P.dim,fontStyle:"italic"}}>
          {nodes.length} nodes · {edges.length} edges · {Math.round(zoom*100)}%
        </span>

        <button onClick={generatePrompt}
          style={{...BS(false),borderColor:P.ink,color:P.ink,fontWeight:700,padding:"4px 14px"}}>
          generate prompt →
        </button>
      </div>

      {/* ── body ────────────────────────────────────────────────────────────── */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {/* ── sidebar ─────────────────────────────────────────────────────── */}
        <div style={{width:240,flexShrink:0,borderRight:`1px solid ${P.grid}`,display:"flex",flexDirection:"column",background:P.paper}}>

          <div style={{display:"flex",borderBottom:`1px solid ${P.grid}`,flexShrink:0}}>
            {["files","props","prompt","settings"].map(t=>(
              <button key={t} onClick={()=>setPanel(t)}
                style={{flex:1,padding:"7px 0",border:"none",cursor:"pointer",fontSize:10,fontFamily:"'Courier Prime',monospace",background:"transparent",borderBottom:`1.5px solid ${panel===t?P.ink:"transparent"}`,color:panel===t?P.ink:P.dim}}>
                {t}
              </button>
            ))}
          </div>

          <div style={{padding:"13px",flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:9}}>

            {/* FILES */}
            {panel==="files"&&(<>
              <div style={{display:"flex",gap:4}}>
                <button onClick={exportJSON} style={{...BS(false),flex:1,padding:"5px",fontSize:10}}>↓ export</button>
                <button onClick={()=>importInput.current.click()} style={{...BS(false),flex:1,padding:"5px",fontSize:10}}>↑ import</button>
                <input ref={importInput} type="file" accept=".json" onChange={importJSON} style={{display:"none"}}/>
              </div>
              <HR/>
              {!settings.apiKeys[settings.provider]&&PROVIDERS.find(p=>p.id===settings.provider)?.hasKey&&(
                <div style={{fontSize:10,color:P.danger,lineHeight:1.6,borderLeft:`2px solid ${P.danger}`,paddingLeft:7,marginBottom:4}}>
                  No API key — set it in Settings
                </div>
              )}
              <Label>local project</Label>
              <div onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={onDrop}
                onClick={()=>fileInput.current.click()}
                style={{border:`1px dashed ${dragging?P.ink:P.faint}`,padding:"20px 12px",textAlign:"center",cursor:"pointer",background:dragging?"#f0ede4":"transparent",transition:"background .1s,border-color .1s"}}>
                <div style={{fontSize:20,lineHeight:1,marginBottom:6,opacity:.3}}>⊞</div>
                <div style={{fontSize:10,color:P.dim,lineHeight:1.7}}>
                  drop a project folder here<br/>
                  <span style={{color:P.ink,fontWeight:700}}>or click to browse</span>
                </div>
              </div>
              <input ref={fileInput} type="file" webkitdirectory="true" multiple onChange={onFileInput} style={{display:"none"}}/>

              {fileInfo&&!err&&(
                <div style={{fontSize:10,color:P.dim,lineHeight:1.8,borderLeft:`2px solid ${P.faint}`,paddingLeft:7}}>
                  <strong style={{color:P.ink}}>{fileInfo.name}</strong><br/>
                  {fileInfo.count} source files · {fileInfo.total} total
                </div>
              )}
              {busy&&<div style={{fontSize:10,color:P.dim,fontStyle:"italic"}}>⟳ {status||"working…"}</div>}
              {err&&<div style={{fontSize:10,color:P.danger,lineHeight:1.6,borderLeft:`2px solid ${P.danger}`,paddingLeft:7}}>{err}</div>}

              <HR/>
              <Label>layout</Label>
              <select value={layoutType} onChange={e=>setLayoutType(e.target.value)}
                style={{...IS,marginBottom:4}}>
                {LAYOUT_OPTIONS.map(o=>(
                  <option key={o.id} value={o.id}>
                    {o.id==="auto"?`auto-detect (${effectiveLabel})`:o.label}
                  </option>
                ))}
              </select>
              <button onClick={()=>applyLayout(layoutType)}
                style={{...BS(layoutFlash),padding:"5px",fontSize:10,width:"100%",
                  fontWeight:layoutFlash?700:400,background:layoutFlash?"#f0ede4":"transparent",transition:"all .3s"}}>
                ⊡ apply layout
              </button>

              <HR/>
              <Label>shortcuts</Label>
              <div style={{fontSize:10,color:P.dim,lineHeight:2,fontStyle:"italic"}}>
                scroll → zoom<br/>drag bg → pan<br/>drag node → move<br/>→ src then dst<br/>× click to delete<br/>dbl-click → enter node
              </div>
            </>)}

            {/* PROPS */}
            {panel==="props"&&(<>
              {!sel&&<div style={{fontSize:10,color:P.dim,fontStyle:"italic",lineHeight:2,paddingTop:16}}>select a node or arrow<br/>to edit its properties</div>}

              {selNode&&(<>
                <Label>label</Label>
                <input value={selNode.label} onChange={e=>updNode(selNode.id,{label:e.target.value})} style={IS}/>
                <Label>type</Label>
                <select value={selNode.type} onChange={e=>updNode(selNode.id,{type:e.target.value})} style={IS}>
                  {Object.entries(NT).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                </select>
                <Label>description</Label>
                <textarea value={selNode.desc||""} onChange={e=>updNode(selNode.id,{desc:e.target.value})} rows={2} style={{...IS,resize:"vertical"}}/>
                <div style={{display:"flex",gap:6}}>
                  <div style={{flex:1}}><Label>x</Label><input type="number" value={selNode.x} onChange={e=>updNode(selNode.id,{x:+e.target.value})} style={IS}/></div>
                  <div style={{flex:1}}><Label>y</Label><input type="number" value={selNode.y} onChange={e=>updNode(selNode.id,{y:+e.target.value})} style={IS}/></div>
                </div>
                <HR/>
                <Label>inputs</Label>
                {(selNode.inputs||[]).map((p,i)=>(
                  <div key={p.id} style={{display:"flex",gap:3,alignItems:"center",marginBottom:3}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:PORT_COLORS[p.type]||P.dim,flexShrink:0,border:`1px solid ${P.ink}`}}/>
                    <input value={p.name} onChange={e=>updNode(selNode.id,{inputs:(selNode.inputs||[]).map((x,j)=>j===i?{...x,name:e.target.value}:x)})} style={{...IS,flex:1,marginTop:0}}/>
                    <select value={p.type} onChange={e=>updNode(selNode.id,{inputs:(selNode.inputs||[]).map((x,j)=>j===i?{...x,type:e.target.value}:x)})} style={{...IS,width:64,marginTop:0,padding:"4px 4px"}}>
                      {PORT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                    <button onClick={()=>updNode(selNode.id,{inputs:(selNode.inputs||[]).filter((_,j)=>j!==i)})} style={{...BS(false,true),padding:"2px 5px",fontSize:10,flexShrink:0}}>×</button>
                  </div>
                ))}
                <button onClick={()=>updNode(selNode.id,{inputs:[...(selNode.inputs||[]),{id:uid(),name:"in",type:"any"}]})} style={{...BS(false),padding:"3px 8px",fontSize:10,width:"100%"}}>+ add input</button>

                <HR/>
                <Label>outputs</Label>
                {(selNode.outputs||[]).map((p,i)=>(
                  <div key={p.id} style={{display:"flex",gap:3,alignItems:"center",marginBottom:3}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:PORT_COLORS[p.type]||P.dim,flexShrink:0,border:`1px solid ${P.ink}`}}/>
                    <input value={p.name} onChange={e=>updNode(selNode.id,{outputs:(selNode.outputs||[]).map((x,j)=>j===i?{...x,name:e.target.value}:x)})} style={{...IS,flex:1,marginTop:0}}/>
                    <select value={p.type} onChange={e=>updNode(selNode.id,{outputs:(selNode.outputs||[]).map((x,j)=>j===i?{...x,type:e.target.value}:x)})} style={{...IS,width:64,marginTop:0,padding:"4px 4px"}}>
                      {PORT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                    <button onClick={()=>updNode(selNode.id,{outputs:(selNode.outputs||[]).filter((_,j)=>j!==i)})} style={{...BS(false,true),padding:"2px 5px",fontSize:10,flexShrink:0}}>×</button>
                  </div>
                ))}
                <button onClick={()=>updNode(selNode.id,{outputs:[...(selNode.outputs||[]),{id:uid(),name:"out",type:"any"}]})} style={{...BS(false),padding:"3px 8px",fontSize:10,width:"100%"}}>+ add output</button>
                <HR/>

                <button onClick={()=>{setEdgeSrc(selNode.id);setMode("ADD_EDGE");}} style={{...BS(false),padding:"5px",fontSize:10,width:"100%",marginTop:4}}>→ connect to another node</button>
                <button onClick={()=>{setNodes(ns=>ns.filter(n=>n.id!==selNode.id));setEdges(es=>es.filter(e=>e.from!==selNode.id&&e.to!==selNode.id));setSel(null);}} style={{...BS(false,true),padding:"5px",fontSize:10,width:"100%"}}>× delete node</button>
              </>)}

              {selEdge&&(()=>{
                const fn=nodes.find(n=>n.id===selEdge.from)?.label||"?";
                const tn=nodes.find(n=>n.id===selEdge.to)?.label||"?";
                return(<>
                  <div style={{fontSize:10,color:P.dim,paddingBottom:8,borderBottom:`1px solid ${P.grid}`,lineHeight:1.7}}>
                    <strong style={{color:P.ink}}>{fn}</strong><span style={{margin:"0 6px"}}>{selEdge.bidir?"↔":"→"}</span><strong style={{color:P.ink}}>{tn}</strong>
                  </div>
                  <Label>label</Label>
                  <input value={selEdge.label||""} onChange={e=>updEdge(selEdge.id,{label:e.target.value})} style={IS}/>
                  <label style={{display:"flex",alignItems:"center",gap:8,fontSize:10,color:P.dim,cursor:"pointer",marginTop:6}}>
                    <input type="checkbox" checked={selEdge.bidir||false} onChange={e=>updEdge(selEdge.id,{bidir:e.target.checked})}/>bidirectional
                  </label>
                  <button onClick={()=>updEdge(selEdge.id,{from:selEdge.to,to:selEdge.from})} style={{...BS(false),padding:"5px",fontSize:10,width:"100%",marginTop:6}}>⇄ flip direction</button>
                  <button onClick={()=>{setEdges(es=>es.filter(e=>e.id!==selEdge.id));setSel(null);}} style={{...BS(false,true),padding:"5px",fontSize:10,width:"100%"}}>× delete arrow</button>
                </>);
              })()}

            </>)}

            {/* SETTINGS */}
            {panel==="settings"&&(()=>{
              const prov=PROVIDERS.find(p=>p.id===settings.provider)||PROVIDERS[0];
              const currentKey=settings.apiKeys[settings.provider]||"";
              return(<>
                <Label>provider</Label>
                <div style={{display:"flex",flexDirection:"column",gap:3,marginTop:2}}>
                  {PROVIDERS.map(p=>(
                    <button key={p.id}
                      onClick={()=>saveSettings({provider:p.id,model:p.defaultModel||settings.model})}
                      style={{...BS(settings.provider===p.id),padding:"4px 8px",fontSize:10,textAlign:"left",width:"100%"}}>
                      {settings.provider===p.id?"· ":""}{p.label}
                    </button>
                  ))}
                </div>

                <HR/>
                <Label>model</Label>
                <input
                  value={settings.model}
                  onChange={e=>saveSettings({model:e.target.value})}
                  placeholder={prov.defaultModel||"model name"}
                  style={IS}
                />

                {prov.hasKey&&(<>
                  <HR/>
                  <Label>api key</Label>
                  <input
                    type="password"
                    placeholder={settings.provider==="anthropic"?"sk-ant-…":"sk-…"}
                    value={currentKey}
                    onChange={e=>saveApiKey(e.target.value)}
                    style={{...IS,letterSpacing:currentKey?"0.12em":"normal"}}
                  />
                  {currentKey&&<div style={{fontSize:9,color:"#6a8a6a",marginTop:1}}>✓ saved in localStorage</div>}
                </>)}

                {prov.hasUrl&&(<>
                  <HR/>
                  <Label>base url</Label>
                  <input
                    value={settings.baseUrl||""}
                    onChange={e=>saveSettings({baseUrl:e.target.value})}
                    placeholder={prov.urlPlaceholder}
                    style={IS}
                  />
                  {settings.provider==="ollama"&&(
                    <div style={{fontSize:9,color:P.dim,marginTop:3,lineHeight:1.6}}>
                      leave empty to use default<br/>
                      <span style={{fontStyle:"italic"}}>http://localhost:11434</span>
                    </div>
                  )}
                </>)}
              </>);
            })()}

            {/* PROMPT */}
            {panel==="prompt"&&(<>
              <Label>claude code prompt</Label>
              {!promptTxt
                ?<div style={{fontSize:10,color:P.dim,fontStyle:"italic",lineHeight:2}}>press "generate prompt →" in the top bar</div>
                :<>
                  <button onClick={()=>{navigator.clipboard.writeText(promptTxt);setCopied(true);setTimeout(()=>setCopied(false),2200);}}
                    style={{...BS(false),padding:"5px",fontWeight:700,width:"100%",background:copied?P.ink:"transparent",color:copied?P.paper:P.ink,borderColor:P.ink}}>
                    {copied?"✓ copied":"copy"}
                  </button>
                  <textarea readOnly value={promptTxt} style={{...IS,flex:1,minHeight:300,resize:"none",lineHeight:1.7,fontSize:10,padding:8}}/>
                </>}
            </>)}
          </div>
        </div>

        {/* ── canvas ────────────────────────────────────────────────────────── */}
        <div style={{flex:1,position:"relative",overflow:"hidden",background:P.cream}}>

          {/* breadcrumb */}
          {navPath.length>0&&(
            <div style={{position:"absolute",top:0,left:0,right:0,zIndex:8,display:"flex",alignItems:"center",gap:4,padding:"4px 12px",background:P.paper,borderBottom:`1px solid ${P.grid}`,fontSize:10,fontFamily:"'Courier Prime',monospace",flexWrap:"wrap"}}>
              <span style={{cursor:"pointer",color:P.dim}} onClick={()=>exitToLevel(0)}>root</span>
              {navPath.flatMap((entry,idx)=>[
                <span key={`s${idx}`} style={{color:P.faint,margin:"0 1px"}}>›</span>,
                <span key={`e${idx}`}
                  style={{cursor:idx<navPath.length-1?"pointer":"default",color:idx<navPath.length-1?P.dim:P.ink,fontWeight:idx===navPath.length-1?700:400}}
                  onClick={()=>idx<navPath.length-1&&exitToLevel(idx+1)}>
                  {entry.label}
                </span>
              ])}
              <span style={{marginLeft:"auto",fontSize:9,color:P.faint,fontStyle:"italic"}}>double-click any node to enter · click breadcrumb to go back</span>
            </div>
          )}

          {/* dashed frame — visible only inside a nested diagram */}
          {navPath.length>0&&(
            <div style={{position:"absolute",inset:0,border:"1.5px dashed rgba(28,27,23,0.22)",pointerEvents:"none",zIndex:4}}/>
          )}

          {edgeSrc&&(
            <div style={{position:"absolute",top:navPath.length>0?32:10,left:"50%",transform:"translateX(-50%)",background:P.paper,border:`1px solid ${P.ink}`,padding:"3px 12px",fontSize:10,color:P.ink,zIndex:10,pointerEvents:"none",fontStyle:"italic"}}>
              → click target{edgeSrcPort?" port":""} (or same node for self-loop) · from: <strong>{nodes.find(n=>n.id===edgeSrc)?.label}</strong>
              {edgeSrcPort&&<span style={{color:P.dim}}> › {edgeSrcPort.portType}</span>}
            </div>
          )}

          <svg ref={svgRef} style={{width:"100%",height:"100%",cursor}}
            onMouseDown={onCanvasDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>

            <defs>
              <pattern id="g-sm" width={G} height={G} patternUnits="userSpaceOnUse">
                <path d={`M ${G} 0 L 0 0 0 ${G}`} fill="none" stroke="#e4e1d8" strokeWidth=".4"/>
              </pattern>
              <pattern id="g-lg" width={G*5} height={G*5} patternUnits="userSpaceOnUse">
                <rect width={G*5} height={G*5} fill="url(#g-sm)"/>
                <path d={`M ${G*5} 0 L 0 0 0 ${G*5}`} fill="none" stroke="#d4d1c6" strokeWidth=".7"/>
              </pattern>
              {[["mk","mk-b",.5],["mk-s","mk-bs",1]].map(([id,bid,op])=>(
                <g key={id}>
                  <marker id={id} markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L7,3 z" fill="#1c1b17" opacity={op}/>
                  </marker>
                  <marker id={bid} markerWidth="7" markerHeight="7" refX="1" refY="3" orient="auto-start-reverse">
                    <path d="M7,0 L7,6 L0,3 z" fill="#1c1b17" opacity={op}/>
                  </marker>
                </g>
              ))}
            </defs>

            <rect width="100%" height="100%" fill={P.cream}/>
            <g transform={`translate(${((pan.x%(G*5*zoom))+(G*5*zoom))%(G*5*zoom)-G*5*zoom},${((pan.y%(G*5*zoom))+(G*5*zoom))%(G*5*zoom)-G*5*zoom}) scale(${zoom})`}>
              <rect x={-G*5} y={-G*5} width={Math.ceil(4000/zoom+G*10)} height={Math.ceil(3000/zoom+G*10)} fill="url(#g-lg)"/>
            </g>

            <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

              {/* edges */}
              {edgeData.map(e=>{
                const isSel=sel?.k==="edge"&&sel.id===e.id;
                return(
                  <g key={e.id} onClick={ev=>onEdgeClick(ev,e.id)} style={{cursor:"pointer"}}>
                    <path d={e.path} stroke="transparent" strokeWidth={14} fill="none"/>
                    <path d={e.path} fill="none"
                      stroke={P.ink} strokeWidth={isSel?1.5:.85} opacity={isSel?1:.42}
                      markerEnd={`url(#${isSel?"mk-s":"mk"})`}
                      markerStart={e.bidir&&!e.selfLoop?`url(#${isSel?"mk-bs":"mk-b"})`:undefined}
                      strokeDasharray={mode==="DELETE"?"5 3":undefined}/>
                    {e.label&&(
                      <g>
                        <rect x={e.mx-e.label.length*3.2} y={e.my-13} width={e.label.length*6.4} height={14} fill={P.cream}/>
                        <text x={e.mx} y={e.my-2} textAnchor="middle" fontSize={9} fill={P.dim} fontFamily="'Courier Prime',monospace" fontStyle="italic">{e.label}</text>
                      </g>
                    )}
                    {isSel&&<circle cx={e.mx} cy={e.my} r={3} fill={P.ink}/>}
                  </g>
                );
              })}

              {/* nodes */}
              {nodes.map(n=>{
                const isSel=sel?.k==="node"&&sel.id===n.id;
                const isSrc=edgeSrc===n.id;
                const hasChildren=n.children&&(n.children.nodes?.length||n.children.edges?.length);
                const inputs=n.inputs||[], outputs=n.outputs||[];
                const isBoundary=!!n._boundary;
                return(
                  <g key={n.id} transform={`translate(${n.x},${n.y})`}
                    onMouseDown={e=>onNodeDown(e,n.id)}
                    onDoubleClick={e=>{e.stopPropagation();if(mode==="SELECT"&&!isBoundary)enterNode(n);}}
                    style={{cursor:mode==="DELETE"?"not-allowed":mode==="ADD_EDGE"?"crosshair":"grab"}}>
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
                    {isSel&&[[0,0],[NW,0],[NW,NH],[0,NH]].map(([cx,cy],i)=>(
                      <rect key={i} x={cx-2.5} y={cy-2.5} width={5} height={5} fill={P.ink}/>
                    ))}
                    {hasChildren&&(
                      <text x={NW-8} y={14} fontSize={9} fill={P.dim} fontFamily="'Courier Prime',monospace" textAnchor="middle">⊞</text>
                    )}
                    {/* input pins (left) */}
                    {inputs.map((p,i)=>{
                      const py=portY(i,inputs.length);
                      const isEdgeSrcPort=edgeSrc===n.id&&edgeSrcPort?.portId===p.id;
                      return(
                        <g key={p.id} onMouseDown={e=>onPortDown(e,n.id,p.id,p.type,"input")} style={{cursor:"crosshair"}}>
                          <circle cx={0} cy={py} r={7} fill="transparent"/>
                          <circle cx={0} cy={py} r={4} fill={isEdgeSrcPort?"#f0ede4":PORT_COLORS[p.type]||P.dim} stroke={P.ink} strokeWidth={0.7}/>
                          <text x={5} y={py+3} fontSize={7} fill={P.dim} fontFamily="'Courier Prime',monospace">{p.name}</text>
                        </g>
                      );
                    })}
                    {/* output pins (right) */}
                    {outputs.map((p,i)=>{
                      const py=portY(i,outputs.length);
                      const isActive=edgeSrc===n.id&&edgeSrcPort?.portId===p.id;
                      return(
                        <g key={p.id} onMouseDown={e=>onPortDown(e,n.id,p.id,p.type,"output")} style={{cursor:"crosshair"}}>
                          <circle cx={NW} cy={py} r={7} fill="transparent"/>
                          <circle cx={NW} cy={py} r={4} fill={isActive?P.ink:PORT_COLORS[p.type]||P.dim} stroke={P.ink} strokeWidth={0.7}/>
                          <text x={NW-5} y={py+3} fontSize={7} fill={P.dim} fontFamily="'Courier Prime',monospace" textAnchor="end">{p.name}</text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* zoom */}
          <div style={{position:"absolute",bottom:12,right:12,display:"flex",gap:3}}>
            {[["−",()=>setZoom(z=>Math.max(.2,z*.82))],["↺",()=>{setZoom(.84);setPan({x:60,y:60});}],["+",()=>setZoom(z=>Math.min(3,z*1.22))]].map(([l,fn],i)=>(
              <button key={i} onClick={fn} style={{background:P.paper,border:`1px solid ${P.faint}`,color:P.ink,cursor:"pointer",padding:"2px 9px",fontSize:13,fontFamily:"'Courier Prime',monospace"}}>{l}</button>
            ))}
          </div>

          <div style={{position:"absolute",bottom:12,left:12,fontSize:9,color:P.dim,fontFamily:"'Courier Prime',monospace",fontStyle:"italic"}}>
            {MODES.find(m=>m.id===mode)?.label}
            {mode==="ADD_NODE"&&<span style={{marginLeft:4}}>· {NT[newType]?.label}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
