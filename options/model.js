// Shared by the design options. Same maths as index.html (glapp one-compartment model); only the drawing differs.
export const DRUGS={"tirzepatide-injection":{halfLife:5,bioavailability:.8,volumeOfDistribution:10.3,tmax:1,name:"Tirzepatide",route:"injection"},"semaglutide-injection":{halfLife:7,bioavailability:.89,volumeOfDistribution:12.5,tmax:1.5,name:"Semaglutide",route:"injection"},"semaglutide-oral":{halfLife:7,bioavailability:.01,volumeOfDistribution:12.5,tmax:.042,name:"Semaglutide",route:"tablet"},"retatrutide-injection":{halfLife:6,bioavailability:.8,volumeOfDistribution:10,tmax:1.5,name:"Retatrutide",route:"injection"}};
export const TIRZ="tirzepatide-injection",CLICKS=60,PEN_CLICKS=240,STRENGTHS=[2.5,5,7.5,10,12.5,15];
export function solveKa(tmax,ke){let ka=2.5/tmax;for(let n=0;n<20;n++){const d=ka-ke;if(Math.abs(d)<1e-10)break;const L=Math.log(ka/ke),f=L/d-tmax,fp=(1/ka-L/d)/d;if(Math.abs(fp)<1e-10)break;const nx=ka-f/fp;if(nx<=ke||nx<=0){ka=ke*2;continue}if(Math.abs(nx-ka)<1e-10)break;ka=nx}return ka}
function conc(dose,t,p,ka){if(t<0)return 0;const ke=Math.LN2/p.halfLife,d=ka-ke;if(Math.abs(d)<1e-10)return p.bioavailability*dose*ka/p.volumeOfDistribution*t*Math.exp(-ke*t);return Math.max(0,p.bioavailability*dose*ka/(p.volumeOfDistribution*d)*(Math.exp(-ke*t)-Math.exp(-ka*t)))}
export function doseEvents(s,freq,weeks){const out=[],end=weeks*7,stop=s.to*7;if(s.dose>0)for(let t=(s.from-1)*7;t<stop&&t<=end;t+=freq)out.push({t,dose:s.dose});return out}
export function simulate(events,drug,weeks){const p=DRUGS[drug],ka=solveKa(p.tmax,Math.LN2/p.halfLife),pts=[];for(let k=0;k<=weeks*28;k++){const t=k/4;let c=0;for(const e of events)if(e.t<=t)c+=conc(e.dose,t-e.t,p,ka);pts.push([t,c*p.volumeOfDistribution])}return pts}
export function layout(st){let w=1;st.steps.forEach(s=>{s.weeks=Math.max(1,Math.round(s.weeks)||1);s.from=w;s.to=w+s.weeks-1;w+=s.weeks});const total=w-1;if(total>st.weeks)st.weeks=total;return st}
export const EXAMPLE={start:"2026-08-01",weeks:12,drug:TIRZ,freq:7,clicks:false,gold:false,pens:[{strength:5}],steps:[{dose:2.5,weeks:7,pen:0,clicks:30},{dose:3.7,weeks:1,pen:0,clicks:44},{dose:3.25,weeks:1,pen:0,clicks:39}]};
// Read the real app's saved plan so the options show it; never write to it.
export function loadState(){let v=null;try{v=JSON.parse(localStorage.getItem("glp1-plotter:v1"))}catch{}return layout(structuredClone(v&&Array.isArray(v.steps)&&v.steps.length?v:EXAMPLE))}
export function compute(st){layout(st);const per=st.steps.map(s=>doseEvents(s,st.freq,st.weeks));const events=per.flat();return {per,events,pts:simulate(events,st.drug,st.weeks)}}
export const mg=v=>(+v).toFixed(2).replace(/\.?0+$/,"");
export function dateAt(st,day){const d=new Date(st.start+"T00:00");if(isNaN(d))return null;d.setDate(d.getDate()+Math.floor(day));return d}
export const fmtDate=(st,day,o={day:"numeric",month:"short"})=>{const d=dateAt(st,day);return d?d.toLocaleDateString(undefined,o):`day ${day}`};
