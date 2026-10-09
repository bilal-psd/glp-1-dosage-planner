// Pins the benzodiazepine model. Run: node --test
import {test} from "node:test";
import assert from "node:assert/strict";
import {BENZOS,terms,toNgMl,levelAt,simulate,hourOf,layout,doseEvents,cleanPlan,EXAMPLE} from "../benzo-model.js";

const close=(a,b,eps)=>assert.ok(Math.abs(a-b)<=eps,`${a} ≉ ${b}`);
const plan=(o={})=>({...structuredClone(EXAMPLE),...o});

test("a single dose peaks at Tmax",()=>{
 for(const d of Object.keys(BENZOS)){const s=simulate([{t:0,mg:1}],d,70,48,1,.01);let k=0;for(let i=1;i<s.t.length;i++)if(s.parent[i]>s.parent[k])k=i;close(s.t[k],BENZOS[d].tmax,.02)}});

test("area under a single dose is F·D / (V·ke)",()=>{
 for(const d of Object.keys(BENZOS)){const p=BENZOS[d],ke=Math.LN2/p.halfLife[1],s=simulate([{t:0,mg:2}],d,80,p.halfLife[1]*40,1,.05);
  let auc=0;for(let i=1;i<s.t.length;i++)auc+=(s.parent[i]+s.parent[i-1])/2*.05;close(auc,toNgMl(p.F*2/ke,p.vd,80),auc*1e-3)}});

test("1 mg alprazolam in 70 kg peaks near 15 ng/mL",()=>{
 close(levelAt([{t:0,mg:1}],"alprazolam",70,1.5).total,14.8,.3)});

test("level scales with dose and inversely with weight",()=>{
 const a=levelAt([{t:0,mg:1}],"lorazepam",70,5).total,b=levelAt([{t:0,mg:2}],"lorazepam",140,5).total;close(a,b,1e-12)});

test("fast simulation matches the direct sum",()=>{
 const ev=[{t:0,mg:5},{t:8.3,mg:5},{t:24,mg:2.5},{t:31.1,mg:5}],s=simulate(ev,"diazepam",70,72,1,.5);
 for(const i of [0,1,17,50,100,144]){const L=levelAt(ev,"diazepam",70,s.t[i]);close(s.parent[i],L.parent,1e-9);close(s.metabolite[i],L.metabolite,1e-9)}});

test("diazepam: nordazepam ≈ diazepam at steady state; other drugs have no metabolite",()=>{
 const ev=Array.from({length:120},(_,k)=>({t:k*24,mg:10})),L=levelAt(ev,"diazepam",70,119*24+12);
 close(L.metabolite/L.parent,1,.1);assert.equal(levelAt(ev,"clonazepam",70,500).metabolite,0);
 assert.equal(terms("alprazolam").metabolite.length,0)});

test("a longer half-life gives a higher level later",()=>{
 const ev=[{t:0,mg:1}],at=v=>levelAt(ev,"alprazolam",70,48,v).total;assert.ok(at(0)<at(1)&&at(1)<at(2))});

test("dose times",()=>{assert.equal(hourOf("08:30"),8.5);assert.equal(hourOf("22:00"),22);assert.equal(hourOf("nope"),0)});

test("steps run back to back in days",()=>{
 const s=[{mg:[1],days:3},{mg:[0],days:2},{mg:[.5],days:1}];assert.equal(layout(s),6);assert.deepEqual(s.map(x=>[x.start,x.end]),[[0,3],[3,5],[5,6]])});

test("dose events: one per non-zero dose time per day, up to the chart end",()=>{
 const ev=doseEvents(plan({times:["08:00","20:00"],steps:[{mg:[.5,.25],days:2},{mg:[0,.25],days:1}],days:3}));
 assert.deepEqual(ev.map(e=>[e.t,e.mg,e.step]),[[8,.5,0],[20,.25,0],[32,.5,0],[44,.25,0],[68,.25,1]]);
 assert.equal(doseEvents(plan({times:["08:00"],steps:[{mg:[1],days:10}],days:3})).length,3)});

test("cleanPlan repairs or rejects",()=>{
 assert.equal(cleanPlan(null),null);assert.equal(cleanPlan({drug:"nope",steps:[{}]}),null);assert.equal(cleanPlan({drug:"diazepam",steps:[]}),null);
 const p=cleanPlan({drug:"diazepam",times:["08:00","14:00"],steps:[{mg:[5],days:30}],days:7,weight:"x"});
 assert.deepEqual(p.steps,[{mg:[5,0],days:30}]);assert.equal(p.days,30);assert.equal(p.weight,70);
 assert.equal(cleanPlan({drug:"lorazepam",times:["1:00","2:00","3:00","4:00","5:00"],steps:[{mg:[1],days:1}]}).times.length,4)});
