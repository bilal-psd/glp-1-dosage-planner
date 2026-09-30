// Small SVG area chart with HTML labels (labels stay at real px on any width). Each option styles it with CSS.
import {fmtDate,mg} from "./model.js";
const NS="http://www.w3.org/2000/svg";
function niceStep(max,n=4){const raw=max/n,p=10**Math.floor(Math.log10(raw));return [1,2,2.5,5,10].map(m=>m*p).find(s=>s>=raw)}
export function drawChart(el,{st,pts,events,bands=null,height=320,xEvery=null,yLabel=v=>`${mg(v)} mg`}){
  const days=st.weeks*7,peak=Math.max(...pts.map(p=>p[1]),.5),step=niceStep(peak),top=Math.ceil(peak*1.08/step)*step;
  const X=d=>d/days*1000,Y=v=>height-v/top*height;
  el.innerHTML="";el.classList.add("vz");el.style.height=height+"px";
  const svg=document.createElementNS(NS,"svg");svg.setAttribute("viewBox",`0 0 1000 ${height}`);svg.setAttribute("preserveAspectRatio","none");svg.setAttribute("aria-hidden","true");
  let g="";
  if(bands)for(const b of bands)g+=`<rect class="vz-band ${b.cls||""}" x="${X(b.from)}" width="${X(b.to)-X(b.from)}" y="0" height="${height}" style="${b.style||""}"/>`;
  for(let v=step;v<top+1e-9;v+=step)g+=`<line class="vz-grid" x1="0" x2="1000" y1="${Y(v)}" y2="${Y(v)}"/>`;
  for(const t of new Set(events.map(e=>e.t)))g+=`<line class="vz-dose" x1="${X(t)}" x2="${X(t)}" y1="${height}" y2="${height-8}"/>`;
  const line=pts.map((p,i)=>`${i?"L":"M"}${X(p[0]).toFixed(2)},${Y(p[1]).toFixed(2)}`).join("");
  g+=`<path class="vz-area" d="${line}L1000,${height}L0,${height}Z"/><path class="vz-line" d="${line}"/><line class="vz-base" x1="0" x2="1000" y1="${height}" y2="${height}"/>`;
  svg.innerHTML=g;el.appendChild(svg);
  const lab=(cls,txt,css)=>{const s=document.createElement("span");s.className=cls;s.textContent=txt;Object.assign(s.style,css);el.appendChild(s);return s};
  for(let v=step;v<top+1e-9;v+=step)lab("vz-y",yLabel(v),{top:`${Y(v)/height*100}%`});
  const every=xEvery||7*Math.max(1,Math.ceil(st.weeks/8));
  for(let d=0;d<=days;d+=every)if(d===0||days-d>=every*.6)lab("vz-x"+(d===0?" vz-x0":""),fmtDate(st,d),{left:`${d/days*100}%`});
  // hover: crosshair, dot, tooltip
  const hair=lab("vz-hair","",{}),dot=lab("vz-dot","",{}),tip=lab("vz-tip","",{});
  const hide=()=>el.classList.remove("vz-on");
  el.onpointerleave=hide;
  el.onpointermove=e=>{const r=el.getBoundingClientRect(),f=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),i=Math.round(f*days*4),[t,v]=pts[i];
    const x=t/days*100,dose=events.filter(ev=>Math.floor(ev.t)===Math.floor(t));
    el.classList.add("vz-on");hair.style.left=dot.style.left=`${x}%`;dot.style.top=`${Y(v)/height*100}%`;
    tip.innerHTML=`<strong>${mg(v.toFixed(2))} mg</strong> in your body<br>${fmtDate(st,t,{weekday:"short",day:"numeric",month:"short"})}${dose.length?` · ${mg(dose[0].dose)} mg dose`:""}`;
    tip.style.left=`${x}%`;tip.classList.toggle("vz-flip",x>60)};
  return {X,Y,top,days};
}
export const CHART_CSS=`
.vz{position:relative;touch-action:pan-y}.vz svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.vz-line{fill:none;stroke:var(--vz-line);stroke-width:2;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.vz-area{fill:var(--vz-line);opacity:.1}.vz-grid,.vz-base{stroke:var(--vz-grid);stroke-width:1;vector-effect:non-scaling-stroke}
.vz-dose{stroke:var(--vz-muted);stroke-width:1.5;vector-effect:non-scaling-stroke}
.vz-y{position:absolute;left:0;transform:translateY(-120%);font-size:.75rem;color:var(--vz-muted);font-variant-numeric:tabular-nums;pointer-events:none}
.vz-x{position:absolute;top:100%;margin-top:6px;transform:translateX(-50%);font-size:.75rem;color:var(--vz-muted);white-space:nowrap;pointer-events:none}
.vz-x0{transform:none}
.vz-hair,.vz-dot,.vz-tip{position:absolute;pointer-events:none;opacity:0}.vz-on .vz-hair,.vz-on .vz-dot,.vz-on .vz-tip{opacity:1}
.vz-hair{top:0;bottom:0;width:1px;background:var(--vz-muted)}
.vz-dot{width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:var(--vz-line);box-shadow:0 0 0 2px var(--vz-surface)}
.vz-tip{top:4px;margin-left:10px;padding:6px 10px;border-radius:6px;background:var(--vz-tip-bg);color:var(--vz-tip-ink);font-size:.8125rem;line-height:1.35;white-space:nowrap}
.vz-tip.vz-flip{transform:translateX(-100%);margin-left:-10px}
`;
