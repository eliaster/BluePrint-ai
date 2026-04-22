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

// ── diagram helpers ───────────────────────────────────────────────────────────
function mkNode(label="Node", x=200, y=200, type="process") {
  return { id:uid(), label, x, y, type, desc:"" };
}
function mkEdge(from, to, label="") {
  return { id:uid(), from, to, label, bidir:false };
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

// ── layout algorithms ─────────────────────────────────────────────────────────

function detectLayout(nodes, edges) {
  if (nodes.length <= 3) return "lr";
  const inDeg={}, outDeg={};
  nodes.forEach(n=>{ inDeg[n.id]=0; outDeg[n.id]=0; });
  edges.forEach(e=>{ inDeg[e.to]=(inDeg[e.to]||0)+1; outDeg[e.from]=(outDeg[e.from]||0)+1; });
  const maxDeg = Math.max(...nodes.map(n=>(inDeg[n.id]||0)+(outDeg[n.id]||0)));
  const roots  = nodes.filter(n=>inDeg[n.id]===0).length;
  const density= edges.length / Math.max(nodes.length,1);
  if (maxDeg >= nodes.length * 0.45) return "radial";   // hub/spoke
  if (density > 2.2)                 return "force";    // dense mesh
  if (roots >= 3)                    return "tb";       // multiple entries → top-down
  return "lr";                                          // default: left-right
}

// Break cycles and return layer assignment via longest-path
function assignLayers(nodes, edges) {
  const outAdj={}, inAdj={};
  nodes.forEach(n=>{ outAdj[n.id]=[]; inAdj[n.id]=[]; });
  edges.forEach(e=>{
    if(outAdj[e.from]&&inAdj[e.to]){ outAdj[e.from].push(e.to); inAdj[e.to].push(e.from); }
  });
  // DFS cycle detection → remove back-edges
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
  // Longest-path layering
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

// Barycenter crossing reduction (4 passes)
function reduceCrossings(layerGroups, inAdj, outAdj, maxLayer) {
  const groups = {};
  for(let i=0;i<=maxLayer;i++) groups[i]=[...layerGroups[i]];
  for(let pass=0;pass<4;pass++){
    // forward
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
    // backward
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

// Spacing constants — guarantees no overlap
const HGAP = 60;  // horizontal gap between nodes
const VGAP = 48;  // vertical gap between nodes
const SLOT_W = NW + HGAP;  // 260
const SLOT_H = NH + VGAP;  // 120

// Push apart any remaining overlaps (5 passes, axis-aligned)
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
          // push along the smaller overlap axis
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

  const numL = maxLayer+1;
  const positions = {};

  if(dir==="lr"){
    // x: fixed column pitch = SLOT_W + extra breathing room
    const colPitch = Math.max(SLOT_W, SLOT_W);
    Object.entries(sorted).forEach(([l,ids])=>{
      const x = 80 + (+l) * (NW + HGAP + 40);
      const totalH = ids.length * SLOT_H;
      const startY = Math.max(60, 300 - totalH/2);
      ids.forEach((id,i)=>{
        positions[id]={x:snap(x), y:snap(startY + i*SLOT_H)};
      });
    });
  } else { // tb
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
  // radius for ring d must fit all its nodes without overlap:
  // circumference >= count * (diagonal + gap), so r >= count*(diag+gap)/(2π)
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
  // initialise on a grid with proper spacing
  const cols=Math.ceil(Math.sqrt(N));
  nodes.forEach((n,i)=>{
    pos[n.id]={x:100+(i%cols)*SLOT_W, y:80+Math.floor(i/cols)*SLOT_H};
    vel[n.id]={x:0, y:0};
  });

  // repulsion constant scaled to node area
  const IDEAL = Math.hypot(SLOT_W, SLOT_H) * 1.1;
  const REPEL = SLOT_W * SLOT_H * 18;
  const ATTRACT = 0.22, DAMP = 0.5, ITERS = 180;

  for(let it=0;it<ITERS;it++){
    const cool = 1 - it/ITERS;
    const F={};
    nodes.forEach(n=>F[n.id]={x:0,y:0});
    // repulsion (node-centre to node-centre, but uses bounding-box distance)
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
    // spring attraction along edges
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

  // normalise so bounding box fits [80,1260]×[80,520]
  const xs=nodes.map(n=>pos[n.id].x), ys=nodes.map(n=>pos[n.id].y);
  const mnX=Math.min(...xs), mxX=Math.max(...xs)+NW;
  const mnY=Math.min(...ys), mxY=Math.max(...ys)+NH;
  const scX=mxX>mnX ? (1180-80)/(mxX-mnX) : 1;
  const scY=mxY>mnY ? (520-80) /(mxY-mnY) : 1;
  const sc=Math.min(scX,scY,1.0); // don't scale up, only down
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

// ── default diagram (pre-laid-out) ────────────────────────────────────────────
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
const BS=(active,danger)=>({padding:"4px 10px",borderRadius:0,cursor:"pointer",fontSize:11,fontFamily:"'Courier New',monospace",background:"transparent",border:`1px solid ${danger?"#a83228":active?"#1c1b17":"#d4d1c6"}`,color:danger?"#a83228":active?"#1c1b17":"#8a8880"});

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
async function analyzeLocalFiles(files, setStatus){
  const relevant=[...files].filter(f=>RELEVANT.test(f.name)&&!SKIP.test(f.webkitRelativePath||f.name))
    .sort((a,b)=>scoreFile(a.webkitRelativePath||a.name)-scoreFile(b.webkitRelativePath||b.name)).slice(0,MAX_FILES);
  if(!relevant.length) throw new Error("No supported source files found.");
  setStatus(`reading ${relevant.length} files…`);
  const chunks=await Promise.all(relevant.map(async f=>{
    try{const t=await readFile(f);return `=== ${f.webkitRelativePath||f.name} ===\n${t.slice(0,MAX_CHARS)}`;}catch{return null;}
  }));
  const corpus=chunks.filter(Boolean).join("\n\n");
  const projectName=relevant[0]?.webkitRelativePath?.split("/")[0]||"project";
  setStatus("analysing with claude…");
  const res=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"claude-sonnet-4-20250514",max_tokens:2000,
      system:`You are a software architecture analyzer. Return ONLY valid JSON (no fences):
{"nodes":[{"id":"n1","label":"Short Label","type":"process|data|api|ui|external","desc":"one-line","x":100,"y":150}],"edges":[{"id":"e1","from":"n1","to":"n2","label":"flow","bidir":false}]}
Rules: 6-14 nodes, 5-16 edges. x 80-1280 y 80-520. labels max 4 words title-case. desc max 8 words. bidir only genuine two-way flows. Show REAL architecture: entry→logic→data→external.`,
      messages:[{role:"user",content:`Project: ${projectName}\n\n${corpus}`}]
    })
  });
  if(!res.ok){const t=await res.text().catch(()=>"");throw new Error(`API ${res.status}${t?": "+t.slice(0,100):""}`);}
  const d=await res.json();
  if(d.error)throw new Error(d.error.message);
  const textBlocks=(d.content||[]).filter(b=>b.type==="text");
  const raw=(textBlocks[textBlocks.length-1]?.text||"").replace(/```json|```/g,"").trim();
  if(!raw)throw new Error("Empty response — try again");
  const match=raw.match(/\{[\s\S]*\}/);
  if(!match)throw new Error("Could not parse JSON");
  return JSON.parse(match[0]);
}

// ── helpers ───────────────────────────────────────────────────────────────────
function Label({children}){return <div style={{fontSize:9,fontWeight:700,letterSpacing:1.8,color:"#8a8880",marginTop:4}}>{children}</div>;}
function HR(){return <div style={{borderTop:"1px solid #e4e1d8",margin:"4px 0"}}/>;}

// ── main ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [nodes,setNodes]       = useState(DN);
  const [edges,setEdges]       = useState(DE);
  const [mode,setMode]         = useState("SELECT");
  const [newType,setNewType]   = useState("process");
  const [sel,setSel]           = useState(null);
  const [edgeSrc,setEdgeSrc]   = useState(null);
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
  const [layoutType,setLayoutType]     = useState("auto");
  const [detectedLayout,setDetectedLayout] = useState("lr");
  const [layoutFlash,setLayoutFlash]   = useState(false);

  const svgRef=useRef(null), fileInput=useRef(null);

  useEffect(()=>{
    if(document.getElementById("bp-font"))return;
    const l=document.createElement("link");
    l.id="bp-font";l.rel="stylesheet";
    l.href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Courier+Prime:ital,wght@0,400;0,700;1,400&display=swap";
    document.head.appendChild(l);
  },[]);

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
    if(mode==="ADD_EDGE"){if(!edgeSrc){setEdgeSrc(id);return;}if(edgeSrc!==id){setEdges(es=>[...es,mkEdge(edgeSrc,id)]);setEdgeSrc(null);setMode("SELECT");}return;}
    setSel({k:"node",id});
    const node=nodes.find(n=>n.id===id), pt=toSvg(e);
    setDrag({id,ox:pt.x-node.x,oy:pt.y-node.y});
  },[mode,edgeSrc,nodes,sel,toSvg]);

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
    const arr=[...files];
    const relevant=arr.filter(f=>RELEVANT.test(f.name)&&!SKIP.test(f.webkitRelativePath||f.name));
    const projectName=arr[0]?.webkitRelativePath?.split("/")[0]||arr[0]?.name||"project";
    setFileInfo({name:projectName,count:relevant.length,total:arr.length});
    setErr("");
    if(!relevant.length){setErr("No supported source files found.");return;}
    setBusy(true);
    try{
      const d=await analyzeLocalFiles(arr,setStatus);
      const newNodes=d.nodes.map(n=>({...n,desc:n.desc||""}));
      const newEdges=d.edges.map(e=>({...e,bidir:e.bidir||false}));
      // auto-layout with fresh data
      const effective=detectLayout(newNodes,newEdges);
      setDetectedLayout(effective);
      setLayoutType("auto");
      const pos=computeLayout(newNodes,newEdges,effective);
      setNodes(applyPositions(newNodes,pos));
      setEdges(newEdges);
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

  // ── prompt ───────────────────────────────────────────────────────────────────
  const generatePrompt=()=>{
    const nl=nodes.map(n=>`- **${n.label}** [${n.type}]${n.desc?": "+n.desc:""}`).join("\n");
    const el=edges.map(e=>{const fn=nodes.find(n=>n.id===e.from)?.label||"?";const tn=nodes.find(n=>n.id===e.to)?.label||"?";return `- ${fn} ${e.bidir?"↔":"→"} ${tn}${e.label?` (${e.label})`:""}`;}).join("\n");
    setPromptTxt(`# Architecture refactoring blueprint\n\nRestructure the codebase to implement the architecture below exactly.\n\n## Modules / components\n\n${nl}\n\n## Data & control flows\n\n${el}\n\n## Steps\n\n1. Create module/directory structure matching the components above\n2. Implement each with a single clear responsibility matching its type\n3. Wire data flows exactly as specified — no extra coupling\n4. Define clean interfaces at every boundary\n5. Preserve all existing business logic\n6. Add types and annotations throughout\n7. Write unit tests for every new or changed module\n8. Update all imports, exports, dependency declarations\n\nWork from data layer outward: data stores → services → API → UI.\nConfirm each step before proceeding.`);
    setPanel("prompt");
  };

  // ── derived ──────────────────────────────────────────────────────────────────
  const edgeData=edges.map(e=>{const fn=nodes.find(n=>n.id===e.from),tn=nodes.find(n=>n.id===e.to);if(!fn||!tn)return null;return{...e,...edgePts(fn,tn)};}).filter(Boolean);
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
          blueprint
          <span style={{fontStyle:"normal",fontSize:10,fontFamily:"'Courier Prime',monospace",color:P.dim,marginLeft:5,letterSpacing:1}}>EDITOR</span>
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

        {/* layout controls */}
        <select value={layoutType} onChange={e=>setLayoutType(e.target.value)}
          style={{...IS,width:"auto",marginTop:0,padding:"3px 7px"}}>
          {LAYOUT_OPTIONS.map(o=>(
            <option key={o.id} value={o.id}>
              {o.id==="auto"?`auto (${effectiveLabel})`:o.label}
            </option>
          ))}
        </select>

        <button onClick={()=>applyLayout(layoutType)}
          style={{...BS(layoutFlash),padding:"4px 11px",fontWeight:layoutFlash?700:400,
            background:layoutFlash?"#f0ede4":"transparent",transition:"all .3s"}}>
          ⊡ re-layout
        </button>

        <div style={{flex:1}}/>

        <span style={{fontSize:10,color:P.dim,fontStyle:"italic"}}>
          {nodes.length} nodes · {edges.length} edges · {Math.round(zoom*100)}%
        </span>

        <button onClick={()=>{setZoom(.84);setPan({x:60,y:60});}} style={{...BS(false),fontSize:10}}>reset</button>

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
            {["files","props","prompt"].map(t=>(
              <button key={t} onClick={()=>setPanel(t)}
                style={{flex:1,padding:"7px 0",border:"none",cursor:"pointer",fontSize:10,fontFamily:"'Courier Prime',monospace",background:"transparent",borderBottom:`1.5px solid ${panel===t?P.ink:"transparent"}`,color:panel===t?P.ink:P.dim}}>
                {t}
              </button>
            ))}
          </div>

          <div style={{padding:"13px",flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:9}}>

            {/* FILES */}
            {panel==="files"&&(<>
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
              <Label>auto layout</Label>
              <div style={{fontSize:10,color:P.dim,lineHeight:1.9}}>
                <span style={{color:P.ink,fontWeight:700}}>{effectiveLabel}</span>
                {layoutType==="auto"&&<span style={{fontStyle:"italic"}}> (detected)</span>}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:3,marginTop:2}}>
                {LAYOUT_OPTIONS.filter(o=>o.id!=="auto").map(o=>(
                  <button key={o.id}
                    onClick={()=>{setLayoutType(o.id);applyLayout(o.id);}}
                    style={{...BS(layoutType===o.id||(layoutType==="auto"&&detectedLayout===o.id)),
                      padding:"4px 8px",fontSize:10,textAlign:"left",width:"100%"}}>
                    {layoutType===o.id||(layoutType==="auto"&&detectedLayout===o.id)?"· ":""}{o.label}
                  </button>
                ))}
                <button onClick={()=>{setLayoutType("auto");applyLayout("auto");}}
                  style={{...BS(layoutType==="auto"),padding:"4px 8px",fontSize:10,textAlign:"left",width:"100%",marginTop:2}}>
                  {layoutType==="auto"?"· ":""}auto-detect
                </button>
              </div>

              <HR/>
              <Label>node types</Label>
              {Object.entries(NT).map(([k,v])=>(
                <div key={k} style={{display:"flex",alignItems:"center",gap:7,marginBottom:3}}>
                  <div style={{width:7,height:7,border:`1px solid ${P.ink}`,flexShrink:0,background:nodeFill(k)}}/>
                  <span style={{fontSize:10,color:P.dim}}>{v.label}</span>
                </div>
              ))}

              <HR/>
              <Label>shortcuts</Label>
              <div style={{fontSize:10,color:P.dim,lineHeight:2,fontStyle:"italic"}}>
                scroll → zoom<br/>drag bg → pan<br/>drag node → move<br/>→ src then dst<br/>× click to delete
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

              <div style={{marginTop:"auto",paddingTop:10,borderTop:`1px solid ${P.grid}`}}>
                <Label>quick add</Label>
                <select value={newType} onChange={e=>setNewType(e.target.value)} style={{...IS,marginBottom:6}}>
                  {Object.entries(NT).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                </select>
                <button onClick={()=>{const n=mkNode("New node",240,240,newType);setNodes(ns=>[...ns,n]);setSel({k:"node",id:n.id});}} style={{...BS(false),padding:"5px",fontSize:10,width:"100%"}}>+ add node</button>
              </div>
            </>)}

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
                  <div style={{fontSize:9,color:P.dim,lineHeight:1.6,borderTop:`1px solid ${P.grid}`,paddingTop:8,fontStyle:"italic"}}>paste into Claude Code inside your project directory.</div>
                </>}
            </>)}
          </div>
        </div>

        {/* ── canvas ────────────────────────────────────────────────────────── */}
        <div style={{flex:1,position:"relative",overflow:"hidden",background:P.cream}}>

          {edgeSrc&&(
            <div style={{position:"absolute",top:10,left:"50%",transform:"translateX(-50%)",background:P.paper,border:`1px solid ${P.ink}`,padding:"3px 12px",fontSize:10,color:P.ink,zIndex:10,pointerEvents:"none",fontStyle:"italic"}}>
              → click target · from: <strong>{nodes.find(n=>n.id===edgeSrc)?.label}</strong>
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
                    <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="transparent" strokeWidth={14}/>
                    <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                      stroke={P.ink} strokeWidth={isSel?1.5:.85} opacity={isSel?1:.42}
                      markerEnd={`url(#${isSel?"mk-s":"mk"})`}
                      markerStart={e.bidir?`url(#${isSel?"mk-bs":"mk-b"})`:undefined}
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
                return(
                  <g key={n.id} transform={`translate(${n.x},${n.y})`}
                    onMouseDown={e=>onNodeDown(e,n.id)}
                    style={{cursor:mode==="DELETE"?"not-allowed":mode==="ADD_EDGE"?"crosshair":"grab"}}>
                    {(isSel||isSrc)&&<rect x={-5} y={-5} width={NW+10} height={NH+10} fill="none" stroke={P.ink} strokeWidth={.8} strokeDasharray="4 3"/>}
                    <rect x={0} y={0} width={NW} height={NH} fill={nodeFill(n.type)} stroke={P.ink} strokeWidth={isSel||isSrc?1:.55}/>
                    <text x={9} y={15} fontSize={7.5} fill={P.dim} fontFamily="'Courier Prime',monospace" fontWeight="700" letterSpacing={1.5}>{n.type.toUpperCase()}</text>
                    <text x={NW/2} y={n.desc?NH/2+3:NH/2+6} textAnchor="middle" fontSize={14} fill={P.ink} fontFamily="'Instrument Serif',serif" fontStyle="italic">
                      {n.label.length>22?n.label.slice(0,20)+"…":n.label}
                    </text>
                    {n.desc&&<text x={NW/2} y={NH-10} textAnchor="middle" fontSize={9} fill={P.dim} fontFamily="'Courier Prime',monospace">{n.desc.length>28?n.desc.slice(0,26)+"…":n.desc}</text>}
                    {isSel&&[[0,0],[NW,0],[NW,NH],[0,NH]].map(([cx,cy],i)=>(
                      <rect key={i} x={cx-2.5} y={cy-2.5} width={5} height={5} fill={P.ink}/>
                    ))}
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
