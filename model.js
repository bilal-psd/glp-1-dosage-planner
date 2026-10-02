// Pharmacokinetic model and scheduling rules. Ported from glapp.io's plotter; see CLAUDE.md before changing anything here.
// Pure functions only (no DOM), so the browser page and the Node tests load the same code.

export const DRUGS={"semaglutide-injection":{halfLife:7,bioavailability:.89,volumeOfDistribution:12.5,tmax:1.5,name:"Semaglutide (injection)"},"semaglutide-oral":{halfLife:7,bioavailability:.01,volumeOfDistribution:12.5,tmax:.042,name:"Semaglutide (oral)"},"tirzepatide-injection":{halfLife:5,bioavailability:.8,volumeOfDistribution:10.3,tmax:1,name:"Tirzepatide (injection)"},"retatrutide-injection":{halfLife:6,bioavailability:.8,volumeOfDistribution:10,tmax:1.5,name:"Retatrutide (injection)"}};
export const TIRZ="tirzepatide-injection",CLICKS=60,PEN_CLICKS=240,STRENGTHS=[2.5,5,7.5,10,12.5,15];

// ka solved from Tmax with Newton's method on Tmax = ln(ka/ke)/(ka−ke).
export function solveKa(tmax,ke){let ka=2.5/tmax;for(let n=0;n<20;n++){const d=ka-ke;if(Math.abs(d)<1e-10)break;const L=Math.log(ka/ke),f=L/d-tmax,fp=(1/ka-L/d)/d;if(Math.abs(fp)<1e-10)break;const nx=ka-f/fp;if(nx<=ke||nx<=0){ka=ke*2;continue}if(Math.abs(nx-ka)<1e-10)break;ka=nx}return ka}
// Bateman curve for one dose, t days after it.
export function conc(dose,t,p){if(t<0)return 0;const ke=Math.LN2/p.halfLife,ka=solveKa(p.tmax,ke),d=ka-ke;if(Math.abs(d)<1e-10)return p.bioavailability*dose*ka/p.volumeOfDistribution*t*Math.exp(-ke*t);return Math.max(0,p.bioavailability*dose*ka/(p.volumeOfDistribution*d)*(Math.exp(-ke*t)-Math.exp(-ka*t)))}
// Dose days for a step (after layout): its n doses, every freq days from the step's first day; none past the chart end.
export function doseEvents(s,freq,weeks){const out=[],end=weeks*7;if(s.dose>0)for(let k=0;k<s.doses;k++){const t=s.start+k*freq;if(t>end)break;out.push({t,dose:s.dose})}return out}
// Superposition of every past dose, sampled every 6 h, reported as mg in the body (concentration × Vd).
export function simulate(events,drug,weeks){const p=DRUGS[drug],pts=[];for(let k=0;k<=weeks*28;k++){const t=k/4;let c=0;for(const e of events)if(e.t<=t)c+=conc(e.dose,t-e.t,p);pts.push([t,c*p.volumeOfDistribution])}return pts}
// mg in the body at day t from doses taken strictly before t (the amount just before a dose on day t).
export function amountBefore(events,drug,t){const p=DRUGS[drug];let c=0;for(const e of events)if(e.t<t)c+=conc(e.dose,t-e.t,p);return c*p.volumeOfDistribution}

// Steps run back to back in dose slots: a step of n doses takes n slots of freq days, so dose k of the plan is on day k·freq.
// A 0 mg step takes its slots without dosing (a pause). Sets each step's start/end (days, end-exclusive) and from/to
// (the calendar weeks it covers, for labels). Returns the chart length in weeks needed to reach the end of the last step.
// 7, 1, 1 doses every 7 days → days 0–48, 49–55, 56–62 → weeks 1–7, 8, 9.
export function layout(steps,freq){let k=0;steps.forEach(s=>{s.doses=Math.max(1,Math.round(s.doses)||1);s.start=k*freq;k+=s.doses;s.end=k*freq;s.from=Math.floor(s.start/7)+1;s.to=Math.ceil(s.end/7)});return Math.ceil(k*freq/7)}
// Plans saved before steps were counted in doses gave each step a length in weeks. Convert it to the number of doses the
// old rule produced (every freq days from the step's first day, end-exclusive): ⌈weeks·7 / freq⌉. Same dose days at freq 7.
export const weeksToDoses=(weeks,freq)=>Math.max(1,Math.ceil(Math.max(1,Math.round(weeks)||1)*7/freq-1e-9));
export function upgradePlan(plan){plan.steps.forEach(s=>{if(s.doses==null&&s.weeks!=null)s.doses=weeksToDoses(s.weeks,plan.freq||7);delete s.weeks});return plan}
export const toClicks=(mg,strength)=>Math.min(CLICKS,Math.max(0,Math.round(mg/strength*CLICKS)));
export const clicksToMg=(clicks,strength)=>+(clicks*strength/CLICKS).toFixed(4);

export const EXAMPLE={start:"2026-08-01",weeks:12,drug:TIRZ,freq:7,clicks:false,gold:false,pens:[],steps:[{dose:2.5,doses:7},{dose:3.7,doses:1},{dose:3.25,doses:1}]};

// A glapp-style link (medicationN, doseN, fromN, toN, frequencyN, start_date, length) → a plan.
// glapp steps are week ranges; each becomes the number of doses it held (weeksToDoses). Gaps become 0 mg pause steps;
// overlaps are cut. Returns null when the link has no plan, plus messages to show.
export function fromGlappParams(q,esc=String){if(!q.has("medication1"))return null;const notes=[];
 const rows=[];for(let i=1;q.has("medication"+i);i++)rows.push({drug:q.get("medication"+i),dose:+q.get("dose"+i),from:+q.get("from"+i),to:+q.get("to"+i),freq:+q.get("frequency"+i)});
 rows.sort((a,b)=>a.from-b.from);const drug=rows[0].drug in DRUGS?rows[0].drug:TIRZ,freq=rows[0].freq||7,steps=[];let next=1;
 for(const r of rows){if(r.from>next)steps.push({dose:0,doses:weeksToDoses(r.from-next,freq)});steps.push({dose:r.dose,doses:weeksToDoses(r.to-Math.max(r.from,next)+1,freq)});next=Math.max(next,r.to+1)}
 if(!(rows[0].drug in DRUGS))notes.push(`The link's medication “${esc(rows[0].drug)}” isn't supported, so ${DRUGS[TIRZ].name} is used.`);
 const drugs=new Set(rows.map(r=>r.drug)),freqs=new Set(rows.map(r=>r.freq||7));
 if(drugs.size>1)notes.push(`The link has ${drugs.size} medications. This plotter shows one, so every step uses ${DRUGS[drug].name}.`);
 if(freqs.size>1)notes.push(`The link doses at different intervals (${[...freqs].join(", ")} days). Every step now doses every ${freq} days; change “Dose every” if that's wrong.`);
 return {state:{...structuredClone(EXAMPLE),start:q.get("start_date")||EXAMPLE.start,weeks:+(q.get("length")||12),drug,freq,steps},notes}}
