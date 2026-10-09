// The benzodiazepine plotter's maths and scheduling rules, a pure ES module like model.js. Same one-compartment oral model
// (Bateman curve, ka solved from Tmax with model.js's solveKa), but in hours, as a blood level in ng/mL for the person's
// weight, with an optional active metabolite (diazepam → nordazepam) and a low / typical / high half-life range.
import {solveKa} from "./model.js";

// Parameters from the US labels where they give one, else the review literature (see AGENTS.md for sources).
// halfLife is [low, typical, high] in hours: the spread between healthy adults (high also covers older people).
// tmax in hours; F = oral bioavailability; vd in L/kg. A metabolite is formed from fm of the parent's elimination
// (mw = its molar mass / the parent's) and has its own half-life range, paired with the parent's (low with low).
export const BENZOS={
 alprazolam:{name:"Alprazolam",brand:"Xanax",halfLife:[6.3,11.2,26.9],tmax:1.5,F:.9,vd:.8},
 clonazepam:{name:"Clonazepam",brand:"Klonopin / Rivotril",halfLife:[17,35,60],tmax:2.5,F:.9,vd:3},
 lorazepam:{name:"Lorazepam",brand:"Ativan",halfLife:[10,12,20],tmax:2,F:.9,vd:1.3},
 diazepam:{name:"Diazepam",brand:"Valium",halfLife:[20,40,100],tmax:1.25,F:.95,vd:.9,
  // fm is set so that, at the typical half-lives, nordazepam ≈ diazepam at steady state, as reported at usual doses.
  metabolite:{name:"Nordazepam",halfLife:[40,71,100],fm:.64,mw:270.7/284.7,vd:.9}}};
export const VARIANTS=[0,1,2],TYPICAL=1,MAX_TIMES=4;

// One curve as a sum of exponentials: for a 1 mg dose at t = 0, the amount in the body (mg) is Σ c·e^(−k·t), split into
// the parent drug's terms and the metabolite's. Exponentials make superposition cheap (see simulate).
export function terms(drug,v=TYPICAL){const p=BENZOS[drug],ke=Math.LN2/p.halfLife[v],ka=solveKa(p.tmax,ke),A=p.F*ka/(ka-ke);
 const parent=[{k:ke,c:A},{k:ka,c:-A}];if(!p.metabolite)return{parent,metabolite:[]};
 // Metabolite: dM/dt = fm·mw·ke·P − km·M, M(0) = 0, which solves to B·[g(ke) − g(ka)] with g(k) = (e^(−kt) − e^(−km·t)) / (km − k).
 const m=p.metabolite,km0=Math.LN2/m.halfLife[v],km=Math.abs(km0-ke)<1e-9?km0*(1+1e-6):km0,B=m.fm*m.mw*ke*A;
 return{parent,metabolite:[{k:ke,c:B/(km-ke)},{k:ka,c:-B/(km-ka)},{k:km,c:B*(1/(km-ka)-1/(km-ke))}]}}

// mg in the body → ng/mL in blood for a body weight in kg (mg/L × 1000).
export const toNgMl=(mg,vdPerKg,kg)=>mg/(vdPerKg*kg)*1000;

// Level at one time t (hours) from every earlier dose, by direct sum: { parent, metabolite, total } in ng/mL.
export function levelAt(events,drug,kg,t,v=TYPICAL){const p=BENZOS[drug],T=terms(drug,v);let a=0,b=0;
 for(const e of events)if(e.t<=t){const dt=t-e.t;for(const x of T.parent)a+=e.mg*x.c*Math.exp(-x.k*dt);for(const x of T.metabolite)b+=e.mg*x.c*Math.exp(-x.k*dt)}
 const parent=Math.max(0,toNgMl(a,p.vd,kg)),metabolite=p.metabolite?Math.max(0,toNgMl(b,p.metabolite.vd,kg)):0;return{parent,metabolite,total:parent+metabolite}}

// The level every dt hours from 0 to `hours`, for one half-life variant: { t, parent, metabolite } as Float64Arrays
// (t in hours, levels in ng/mL). Each exponential term keeps a running sum of past doses that decays by e^(−k·dt) per
// sample, so the cost is samples + doses, not their product. Doses must be sorted by time.
export function simulate(events,drug,kg,hours,v=TYPICAL,dt=.25){const p=BENZOS[drug],T=terms(drug,v),n=Math.floor(hours/dt+1e-9)+1;
 const all=[...T.parent.map(x=>({...x,m:0})),...T.metabolite.map(x=>({...x,m:1}))],decay=all.map(x=>Math.exp(-x.k*dt)),sum=all.map(()=>0);
 const t=new Float64Array(n),parent=new Float64Array(n),metabolite=new Float64Array(n),vp=p.vd*kg,vm=p.metabolite?p.metabolite.vd*kg:1;let j=0;
 for(let i=0;i<n;i++){const ti=i*dt;if(i)for(let q=0;q<all.length;q++)sum[q]*=decay[q];
  for(;j<events.length&&events[j].t<=ti+1e-9;j++){const e=events[j];for(let q=0;q<all.length;q++)sum[q]+=e.mg*all[q].c*Math.exp(-all[q].k*Math.max(0,ti-e.t))}
  let a=0,b=0;for(let q=0;q<all.length;q++)all[q].m?b+=sum[q]:a+=sum[q];
  t[i]=ti;parent[i]=Math.max(0,a/vp*1000);metabolite[i]=p.metabolite?Math.max(0,b/vm*1000):0}
 return{t,parent,metabolite}}

// "08:30" → 8.5 (hours after midnight); anything unreadable → 0.
export const hourOf=s=>{const m=/^(\d{1,2}):(\d{2})/.exec(s||"");return m?Math.min(23.99,+m[1]+ +m[2]/60):0};

// A plan: start date, body weight (kg), one drug, the day's dose times ("HH:MM", up to 4) and an ordered list of steps.
// Each step gives the mg at each dose time (0 = no dose then) and runs for a number of days; steps run back to back.
// Sets each step's start/end (days, end-exclusive) and returns the days the steps cover.
export function layout(steps){let d=0;steps.forEach(s=>{s.days=Math.max(1,Math.round(s.days)||1);s.start=d;d+=s.days;s.end=d});return d}

// Every dose of the plan up to the chart end, sorted by time: { t (hours from midnight on the start date), mg, step }.
export function doseEvents(plan){const steps=structuredClone(plan.steps);layout(steps);const end=plan.days*24,hs=plan.times.map(hourOf),out=[];
 steps.forEach((s,i)=>{for(let d=s.start;d<s.end;d++)hs.forEach((h,j)=>{const mg=+s.mg[j]||0,t=d*24+h;if(mg>0&&t<=end)out.push({t,mg,step:i})})});
 return out.sort((a,b)=>a.t-b.t||a.step-b.step)}

// Makes a plan (loaded, imported or from a link) safe to use: known drug, 1–4 times, one mg per time on every step,
// a weight and a chart long enough for the steps (the chart is extended to fit, never shrunk). Returns null if unusable.
export function cleanPlan(v){if(!v||typeof v!=="object"||!(v.drug in BENZOS)||!Array.isArray(v.steps)||!v.steps.length)return null;
 const times=(Array.isArray(v.times)&&v.times.length?v.times:["08:00"]).slice(0,MAX_TIMES).map(String);
 const steps=v.steps.map(s=>({mg:times.map((_,j)=>Math.max(0,+(s&&Array.isArray(s.mg)?s.mg[j]:0)||0)),days:Math.max(1,Math.round(+(s&&s.days))||1)}));
 const p={start:typeof v.start==="string"?v.start:EXAMPLE.start,weight:Math.min(250,Math.max(30,+v.weight||70)),lb:!!v.lb,drug:v.drug,times,steps,days:Math.min(730,Math.max(1,Math.round(+v.days)||28))};
 const need=layout(structuredClone(steps));if(need>p.days)p.days=need;return p}

export const EXAMPLE={start:"2026-10-01",weight:70,lb:false,drug:"alprazolam",times:["08:00","20:00"],steps:[{mg:[.5,.5],days:14}],days:21};
