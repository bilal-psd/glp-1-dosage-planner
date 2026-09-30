// Pharmacokinetic model and scheduling rules. Ported from glapp.io's plotter; see CLAUDE.md before changing anything here.
// Pure functions only (no DOM), so the browser page and the Node tests load the same code.

export const DRUGS={"semaglutide-injection":{halfLife:7,bioavailability:.89,volumeOfDistribution:12.5,tmax:1.5,name:"Semaglutide (injection)"},"semaglutide-oral":{halfLife:7,bioavailability:.01,volumeOfDistribution:12.5,tmax:.042,name:"Semaglutide (oral)"},"tirzepatide-injection":{halfLife:5,bioavailability:.8,volumeOfDistribution:10.3,tmax:1,name:"Tirzepatide (injection)"},"retatrutide-injection":{halfLife:6,bioavailability:.8,volumeOfDistribution:10,tmax:1.5,name:"Retatrutide (injection)"}};
export const TIRZ="tirzepatide-injection",CLICKS=60,PEN_CLICKS=240,STRENGTHS=[2.5,5,7.5,10,12.5,15];

// ka solved from Tmax with Newton's method on Tmax = ln(ka/ke)/(ka−ke).
export function solveKa(tmax,ke){let ka=2.5/tmax;for(let n=0;n<20;n++){const d=ka-ke;if(Math.abs(d)<1e-10)break;const L=Math.log(ka/ke),f=L/d-tmax,fp=(1/ka-L/d)/d;if(Math.abs(fp)<1e-10)break;const nx=ka-f/fp;if(nx<=ke||nx<=0){ka=ke*2;continue}if(Math.abs(nx-ka)<1e-10)break;ka=nx}return ka}
// Bateman curve for one dose, t days after it.
export function conc(dose,t,p){if(t<0)return 0;const ke=Math.LN2/p.halfLife,ka=solveKa(p.tmax,ke),d=ka-ke;if(Math.abs(d)<1e-10)return p.bioavailability*dose*ka/p.volumeOfDistribution*t*Math.exp(-ke*t);return Math.max(0,p.bioavailability*dose*ka/(p.volumeOfDistribution*d)*(Math.exp(-ke*t)-Math.exp(-ka*t)))}
// Dose days for a step: from the first day of its first week, every freq days, stopping before the week after its last week.
export function doseEvents(s,freq,weeks){const out=[],end=weeks*7,stop=s.to*7;if(s.dose>0)for(let t=(s.from-1)*7;t<stop&&t<=end;t+=freq)out.push({t,dose:s.dose});return out}
// Superposition of every past dose, sampled every 6 h, reported as mg in the body (concentration × Vd).
export function simulate(events,drug,weeks){const p=DRUGS[drug],pts=[];for(let k=0;k<=weeks*28;k++){const t=k/4;let c=0;for(const e of events)if(e.t<=t)c+=conc(e.dose,t-e.t,p);pts.push([t,c*p.volumeOfDistribution])}return pts}
// mg in the body at day t from doses taken strictly before t (the amount just before a dose on day t).
export function amountBefore(events,drug,t){const p=DRUGS[drug];let c=0;for(const e of events)if(e.t<t)c+=conc(e.dose,t-e.t,p);return c*p.volumeOfDistribution}

// Start weeks come from stacking step durations: 7, 1, 1 weeks → weeks 1–7, 8, 9.
export function layout(steps){let w=1;steps.forEach(s=>{s.weeks=Math.max(1,Math.round(s.weeks)||1);s.from=w;s.to=w+s.weeks-1;w+=s.weeks});return w-1}
export const toClicks=(mg,strength)=>Math.min(CLICKS,Math.max(0,Math.round(mg/strength*CLICKS)));
export const clicksToMg=(clicks,strength)=>+(clicks*strength/CLICKS).toFixed(4);

export const EXAMPLE={start:"2026-08-01",weeks:12,drug:TIRZ,freq:7,clicks:false,gold:false,pens:[],steps:[{dose:2.5,weeks:7},{dose:3.7,weeks:1},{dose:3.25,weeks:1}]};

// A glapp-style link (medicationN, doseN, fromN, toN, frequencyN, start_date, length) → a plan.
// Gaps become 0 mg pause steps; overlaps are cut. Returns null when the link has no plan, plus messages to show.
export function fromGlappParams(q,esc=String){if(!q.has("medication1"))return null;const notes=[];
 const rows=[];for(let i=1;q.has("medication"+i);i++)rows.push({drug:q.get("medication"+i),dose:+q.get("dose"+i),from:+q.get("from"+i),to:+q.get("to"+i),freq:+q.get("frequency"+i)});
 rows.sort((a,b)=>a.from-b.from);const steps=[];let next=1;
 for(const r of rows){if(r.from>next)steps.push({dose:0,weeks:r.from-next});steps.push({dose:r.dose,weeks:Math.max(1,r.to-Math.max(r.from,next)+1)});next=Math.max(next,r.to+1)}
 const drug=rows[0].drug in DRUGS?rows[0].drug:TIRZ,freq=rows[0].freq||7;
 if(!(rows[0].drug in DRUGS))notes.push(`The link's medication “${esc(rows[0].drug)}” isn't supported, so ${DRUGS[TIRZ].name} is used.`);
 const drugs=new Set(rows.map(r=>r.drug)),freqs=new Set(rows.map(r=>r.freq||7));
 if(drugs.size>1)notes.push(`The link has ${drugs.size} medications. This plotter shows one, so every step uses ${DRUGS[drug].name}.`);
 if(freqs.size>1)notes.push(`The link doses at different intervals (${[...freqs].join(", ")} days). Every step now doses every ${freq} days; change “Dose every” if that's wrong.`);
 return {state:{...structuredClone(EXAMPLE),start:q.get("start_date")||EXAMPLE.start,weeks:+(q.get("length")||12),drug,freq,steps},notes}}
