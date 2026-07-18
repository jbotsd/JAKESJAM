// Offline construct-preview harness. Renders the self-light constructs to PNGs
// via headless chromium (a self-contained canvas page — real additive blend),
// so the presentation harness loop (docs/presentation-completion-goal.md: drive
// -> extract frame -> read semantically -> fix -> repeat) can run for the
// CODE-READY constructs WITHOUT wiring into the live match scene (mid-rewrite by
// a parallel pass) and WITHOUT a running server.
//
// Geometry mirrors render/LightConstruct.ts by hand (that module pulls Phaser
// at runtime; the page reimplements the same math on a browser 2D context).
// Fidelity: shape, composition, color, additive layering, breathing pose, and
// the A18 legibility read (fighters must stay the loudest thing on screen).
//
//   bun run scripts/constructPreview.ts   ->  writes PNGs to $OUT (or scratchpad)

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT =
  process.env.OUT ??
  "/tmp/claude-1000/-home-jimothy/bdaafd55-35f4-4e8d-8220-c0994e3ca7bc/scratchpad/construct-frames";
mkdirSync(OUT, { recursive: true });

// The page: a 720x405 canvas + the construct draw math (mirror of
// LightConstruct.ts). Exposes window.renderScene(name). No backticks inside.
const DRAW_JS = String.raw`
const W = 720, H = 405, TAU = Math.PI * 2;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');

const SYZYGIST = { core: '#eaf2ff', glow: '#5aa0ff', mote: '#bfe0ff' };
const INTERSTICE = { core: '#f2fbff', glow: '#35d6ff', mote: '#bdf0ff' };
const GEOMETRICIAN = { core: '#f6f2ff', glow: '#9a68ff', mote: '#d8ccff' };

function hexA(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}
function arena() {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#12151c'; ctx.fillRect(0,0,W,H);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = '#1b2230';
  for (let x=0;x<W;x+=48) ctx.fillRect(x,0,1,H);
  for (let y=0;y<H;y+=48) ctx.fillRect(0,y,W,1);
  ctx.globalCompositeOperation = 'source-over';
}
function fighter(at, color) {
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(at.x,at.y,2,at.x,at.y,34);
  halo.addColorStop(0,'rgba(255,210,150,0.45)'); halo.addColorStop(1,'rgba(255,210,150,0)');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(at.x,at.y,34,0,TAU); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(at.x,at.y,13,0,TAU); ctx.fill();
  ctx.fillStyle = '#3a2a18'; ctx.fillRect(at.x-4,at.y-3,8,6);
}
function pointOnQuad(a,c,b,t){const u=1-t;return{x:u*u*a.x+2*u*t*c.x+t*t*b.x,y:u*u*a.y+2*u*t*c.y+t*t*b.y};}
function tangentOnQuad(a,c,b,t){const x=2*(1-t)*(c.x-a.x)+2*t*(b.x-c.x),y=2*(1-t)*(c.y-a.y)+2*t*(b.y-c.y);const l=Math.max(1e-4,Math.hypot(x,y));return{x:x/l,y:y/l};}
function breatheCtrl(from,to,sag,amp,hz,phase){const dx=to.x-from.x,dy=to.y-from.y,len=Math.max(1,Math.hypot(dx,dy));const px=-dy/len,py=dx/len;const s=sag+Math.sin(phase*hz*TAU)*amp;return{x:(from.x+to.x)/2+px*s,y:(from.y+to.y)/2+py*s};}
function strokeQuad(from,c,to){ctx.beginPath();ctx.moveTo(from.x,from.y);const n=12;for(let i=1;i<=n;i++){const p=pointOnQuad(from,c,to,i/n);ctx.lineTo(p.x,p.y);}ctx.stroke();}

function tether(from,to,tint,phase){
  ctx.globalCompositeOperation='lighter'; ctx.lineCap='round'; ctx.lineJoin='round';
  const c=breatheCtrl(from,to,10,5,0.9,phase);
  // layered bloom — reads as LIGHT, and the cold tint actually carries
  ctx.strokeStyle=hexA(tint.glow,0.12); ctx.lineWidth=13; strokeQuad(from,c,to);
  ctx.strokeStyle=hexA(tint.glow,0.34); ctx.lineWidth=5;  strokeQuad(from,c,to);
  ctx.strokeStyle=hexA(tint.core,0.8);  ctx.lineWidth=1.7; strokeQuad(from,c,to);
  // binding cinches — bright node + cross-sliver so it reads BOUND, not leashed
  for(const t of [0.34,0.6,0.82]){
    const p=pointOnQuad(from,c,to,t), tan=tangentOnQuad(from,c,to,t), nx=-tan.y, ny=tan.x;
    ctx.strokeStyle=hexA(tint.core,0.7); ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(p.x-nx*5,p.y-ny*5); ctx.lineTo(p.x+nx*5,p.y+ny*5); ctx.stroke();
    ctx.fillStyle=hexA(tint.core,0.9); ctx.beginPath(); ctx.arc(p.x,p.y,1.9,0,TAU); ctx.fill();
  }
  // snare cinch near the marked end — a small loop that says CAUGHT
  const wt=pointOnQuad(from,c,to,0.9), wtan=tangentOnQuad(from,c,to,0.9), wa=Math.atan2(wtan.y,wtan.x);
  ctx.strokeStyle=hexA(tint.glow,0.5); ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(wt.x,wt.y,7,wa-0.4,wa+Math.PI+0.4); ctx.stroke();
  ctx.globalCompositeOperation='source-over';
}
function mote(from,to,tint,t){
  const c=breatheCtrl(from,to,10,0,0.9,0);
  ctx.globalCompositeOperation='lighter';
  // comet trail — feed reads with direction + juice
  for(let k=4;k>=0;k--){
    const tt=Math.max(0,Math.min(1,t*t-k*0.05)); const p=pointOnQuad(from,c,to,tt);
    const r=2.9-k*0.45; if(r<=0) continue;
    ctx.fillStyle=hexA(k===0?tint.core:tint.mote,0.7-k*0.14);
    ctx.beginPath(); ctx.arc(p.x,p.y,r,0,TAU); ctx.fill();
  }
  const hp=pointOnQuad(from,c,to,t*t);
  ctx.fillStyle=hexA(tint.mote,0.28); ctx.beginPath(); ctx.arc(hp.x,hp.y,7,0,TAU); ctx.fill();
  ctx.globalCompositeOperation='source-over';
}
function slivers(at,tint,outward,t,count,len){
  for(let i=0;i<count;i++){
    const a=(i/count)*TAU+(outward?0.5:0.3);
    const r0=outward?8:30, r1=outward?30+len:8, r=r0+(r1-r0)*t;
    const ca=Math.cos(a), sa=Math.sin(a);
    const x0=at.x+ca*(r-len), y0=at.y+sa*(r-len), x1=at.x+ca*r, y1=at.y+sa*r;
    ctx.strokeStyle=hexA(tint.glow,(1-t)*0.3); ctx.lineWidth=5; ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke();
    ctx.strokeStyle=hexA(tint.core,(1-t)*0.9); ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke();
  }
}
function bindBurst(at,tint,outward,t){
  ctx.globalCompositeOperation='lighter'; ctx.lineCap='round';
  const f=outward?1.4:1.7, to=outward?2.1:0.65, s=f+(to-f)*t;
  ctx.strokeStyle=hexA(tint.glow,(1-t)*0.35); ctx.lineWidth=6; ctx.beginPath(); ctx.arc(at.x,at.y,18*s,0,TAU); ctx.stroke();
  ctx.strokeStyle=hexA(tint.core,(1-t)*(outward?0.7:0.55)); ctx.lineWidth=2.2; ctx.beginPath(); ctx.arc(at.x,at.y,18*s,0,TAU); ctx.stroke();
  if(outward){
    // SNAP — sharp flash, longer scatter, two recoiling thread stubs
    ctx.fillStyle=hexA(tint.core,(1-t)*0.6); ctx.beginPath(); ctx.arc(at.x,at.y,(t*22+4)*0.4,0,TAU); ctx.fill();
    slivers(at,tint,true,t,8,14);
    for(const sgn of [-1,1]){
      const bx=at.x+sgn*(10+t*26), by=at.y-sgn*(6+t*14);
      ctx.strokeStyle=hexA(tint.core,(1-t)*0.8); ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(at.x,at.y); ctx.quadraticCurveTo(at.x+sgn*10,at.y-sgn*2,bx,by); ctx.stroke();
    }
  }else{
    // BIND — a catch-pop that focuses inward + converging slivers
    ctx.fillStyle=hexA(tint.core,(1-t)*0.7); ctx.beginPath(); ctx.arc(at.x,at.y,(1-t)*13+3,0,TAU); ctx.fill();
    slivers(at,tint,false,t,6,10);
  }
  ctx.globalCompositeOperation='source-over';
}
function crescent(origin,a0,a1,rOut,rIn){
  ctx.beginPath();
  const n=12;
  for(let i=0;i<=n;i++){const a=a0+(a1-a0)*(i/n);ctx.lineTo(origin.x+Math.cos(a)*rOut,origin.y+Math.sin(a)*rOut);}
  for(let i=n;i>=0;i--){const a=a0+(a1-a0)*(i/n);ctx.lineTo(origin.x+Math.cos(a)*rIn,origin.y+Math.sin(a)*rIn);}
  ctx.closePath();
}
function bladeArc(origin,aim,reach,tint){
  ctx.globalCompositeOperation='lighter'; ctx.lineCap='round';
  const sweep=1.2,a0=aim-sweep/2,a1=aim+sweep/2;
  const edge=(rOut,rIn,ea0,ea1)=>{
    crescent(origin,ea0,ea1,rOut,rIn); ctx.fillStyle=hexA(tint.glow,0.16); ctx.fill();
    ctx.beginPath();const n=10;for(let i=0;i<=n;i++){const a=ea0+(ea1-ea0)*(i/n);const x=origin.x+Math.cos(a)*rOut,y=origin.y+Math.sin(a)*rOut;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.strokeStyle=hexA(tint.core,0.9);ctx.lineWidth=2.5;ctx.stroke();
  };
  // faint motion smear (the flick), then the two blades (dual read)
  crescent(origin,a0-0.25,a1-0.25,reach,reach*0.8); ctx.fillStyle=hexA(tint.glow,0.07); ctx.fill();
  edge(reach,reach*0.82,a0,a1);
  edge(reach*0.7,reach*0.56,a0+0.12,a1-0.05);
  const tip={x:origin.x+Math.cos(a1)*reach,y:origin.y+Math.sin(a1)*reach};
  ctx.fillStyle=hexA(tint.core,0.95); ctx.beginPath(); ctx.arc(tip.x,tip.y,3,0,TAU); ctx.fill();
  ctx.fillStyle=hexA(tint.glow,0.4); ctx.beginPath(); ctx.arc(tip.x,tip.y,6,0,TAU); ctx.fill();
  ctx.globalCompositeOperation='source-over';
}
function lance(origin,aim,length,tint){
  ctx.globalCompositeOperation='lighter'; ctx.lineCap='round'; ctx.lineJoin='round';
  const dx=Math.cos(aim),dy=Math.sin(aim),tip={x:origin.x+dx*length,y:origin.y+dy*length},px=-dy,py=dx,base=6;
  // faceted crystal body — tapered triangle, soft then brighter core
  const tri=(hb,col,a)=>{ctx.beginPath();ctx.moveTo(origin.x+px*hb,origin.y+py*hb);ctx.lineTo(origin.x-px*hb,origin.y-py*hb);ctx.lineTo(tip.x,tip.y);ctx.closePath();ctx.fillStyle=hexA(col,a);ctx.fill();};
  tri(base,tint.glow,0.18); tri(base*0.5,tint.core,0.28);
  ctx.strokeStyle=hexA(tint.glow,0.22); ctx.lineWidth=7; ctx.beginPath(); ctx.moveTo(origin.x,origin.y); ctx.lineTo(tip.x,tip.y); ctx.stroke();
  ctx.strokeStyle=hexA(tint.core,0.9); ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(origin.x,origin.y); ctx.lineTo(tip.x,tip.y); ctx.stroke();
  // facet chevrons pointing forward (crystalline, not tick-marks)
  ctx.strokeStyle=hexA(tint.core,0.75); ctx.lineWidth=1.4;
  for(const at of [0.45,0.66,0.85]){
    const cx=origin.x+dx*length*at, cy=origin.y+dy*length*at, hb=base*(1-at)*1.1, fwd=length*0.08;
    ctx.beginPath(); ctx.moveTo(cx+px*hb,cy+py*hb); ctx.lineTo(cx+dx*fwd,cy+dy*fwd); ctx.lineTo(cx-px*hb,cy-py*hb); ctx.stroke();
  }
  ctx.fillStyle=hexA(tint.core,0.95); ctx.beginPath(); ctx.arc(tip.x,tip.y,3,0,TAU); ctx.fill();
  ctx.fillStyle=hexA(tint.glow,0.4); ctx.beginPath(); ctx.arc(tip.x,tip.y,7,0,TAU); ctx.fill();
  ctx.globalCompositeOperation='source-over';
}

const priest={x:200,y:220}, victim={x:520,y:170};
window.renderScene = function(name){
  arena();
  if(name==='01-syz-hold'){ tether(priest,victim,SYZYGIST,0.25); mote(victim,priest,SYZYGIST,0.4); fighter(priest,'#8fd0ff'); fighter(victim,'#f0c48a'); }
  if(name==='02-syz-bind'){ tether(priest,victim,SYZYGIST,0.0); bindBurst(victim,SYZYGIST,false,0.35); fighter(priest,'#8fd0ff'); fighter(victim,'#f0c48a'); }
  if(name==='03-syz-snap'){ bindBurst(victim,SYZYGIST,true,0.5); fighter(priest,'#8fd0ff'); fighter(victim,'#f0c48a'); }
  if(name==='04-interstice-blade'){ const f={x:360,y:210}; bladeArc(f,-0.35,64,INTERSTICE); fighter(f,'#bff2ff'); }
  if(name==='05-geo-lance'){ const f={x:250,y:210}; lance(f,-0.15,150,GEOMETRICIAN); fighter(f,'#d8ccff'); }
};
`;

const SCENES = ["01-syz-hold", "02-syz-bind", "03-syz-snap", "04-interstice-blade", "05-geo-lance"];

const html = `<!doctype html><html><head><meta charset=utf8><style>body{margin:0;background:#000}</style></head><body><canvas id=c width=720 height=405></canvas><script>${DRAW_JS}</script></body></html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 720, height: 405 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "load" });

for (const name of SCENES) {
  await page.evaluate((n) => (window as unknown as { renderScene: (s: string) => void }).renderScene(n), name);
  await page.locator("#c").screenshot({ path: `${OUT}/${name}.png` });
}

await browser.close();
console.log(`wrote ${SCENES.length} frames to ${OUT}`);
