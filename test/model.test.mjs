// Pins the model so UI work can't drift the maths. Run: node --test
// Reference values were produced by the original inline model in index.html (commit 897be4a) before it moved to model.js.
import {test} from "node:test";
import assert from "node:assert/strict";
import {DRUGS,TIRZ,EXAMPLE,solveKa,doseEvents,simulate,amountBefore,layout,toClicks,clicksToMg,fromGlappParams,weeksToDoses,upgradePlan} from "../model.js";

const close=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} ≉ ${b}`);
const kaOf=d=>solveKa(DRUGS[d].tmax,Math.LN2/DRUGS[d].halfLife);
const example=()=>{const steps=structuredClone(EXAMPLE.steps);layout(steps,7);return steps};

test("drug constants match glapp",()=>{
 assert.deepEqual(Object.fromEntries(Object.entries(DRUGS).map(([k,v])=>[k,[v.halfLife,v.bioavailability,v.volumeOfDistribution,v.tmax]])),{
  "tirzepatide-injection":[5,.8,10.3,1],"semaglutide-injection":[7,.89,12.5,1.5],"semaglutide-oral":[7,.01,12.5,.042],"retatrutide-injection":[6,.8,10,1.5]})});

test("ka solved from Tmax",()=>{
 close(kaOf(TIRZ),3.312189815390614,1e-9);
 close(kaOf("semaglutide-injection"),2.1513743053677667,1e-9);
 close(kaOf("retatrutide-injection"),2.024631145794553,1e-9);
 close(kaOf("semaglutide-oral"),178.61457705417584,1e-6)});

test("layout stacks steps by dose count",()=>{
 const s=example();assert.deepEqual(s.map(x=>[x.start,x.end,x.from,x.to]),[[0,49,1,7],[49,56,8,8],[56,63,9,9]]);assert.equal(layout(s,7),9)});

test("example dose days: 7, 1 and 1 doses every 7 days",()=>{
 const days=example().flatMap(s=>doseEvents(s,7,12)).map(e=>e.t);
 assert.deepEqual(days,[0,7,14,21,28,35,42,49,56])});

test("a step keeps its dose count when the interval changes",()=>{
 const s=[{dose:2.5,doses:2},{dose:5,doses:1}];assert.equal(layout(s,10),5);
 assert.deepEqual(s.flatMap(x=>doseEvents(x,10,12)).map(e=>e.t),[0,10,20])});

test("a 0 mg step is a pause",()=>{
 const s=[{dose:2.5,doses:1},{dose:0,doses:2},{dose:5,doses:1}];layout(s,7);
 assert.deepEqual(s.flatMap(x=>doseEvents(x,7,12)).map(e=>e.t),[0,21])});

test("doses stop at the chart end",()=>{
 const s=[{dose:2.5,doses:10}];layout(s,7);assert.equal(doseEvents(s[0],7,4).length,5)});

test("plans saved with weeks per step become dose counts",()=>{
 assert.equal(weeksToDoses(7,7),7);assert.equal(weeksToDoses(1,10),1);assert.equal(weeksToDoses(2,10),2);assert.equal(weeksToDoses(1,3.5),2);
 const p=upgradePlan({freq:7,steps:[{dose:2.5,weeks:7},{dose:3.7,weeks:1},{dose:3.25,weeks:1}]});
 assert.deepEqual(p.steps,EXAMPLE.steps);
 assert.deepEqual(upgradePlan({freq:7,steps:[{dose:1,doses:3}]}).steps,[{dose:1,doses:3}])});

test("the old plan-wide golden dose setting becomes each pen's own",()=>{
 assert.deepEqual(upgradePlan({freq:7,gold:true,pens:[{strength:5},{strength:10,gold:false}],steps:[{dose:1,doses:1}]}).pens,[{strength:5,gold:true},{strength:10,gold:false}]);
 assert.deepEqual(upgradePlan({freq:7,pens:[{strength:5}],steps:[{dose:1,doses:1}]}).pens,[{strength:5,gold:false}])});

test("amount in body for the example plan",()=>{
 const ev=example().flatMap(s=>doseEvents(s,7,12)),pts=simulate(ev,TIRZ,12);
 assert.equal(pts.length,12*28+1);
 for(const [t,v] of [[1,1.741101],[7,0.790964],[24.5,2.026211],[49,1.272119],[63,1.654497],[84,0.090020]])close(pts[t*4][1],v);
 close(amountBefore(ev,TIRZ,49),1.272119)});

test("pen clicks: 60 clicks = the pen's strength",()=>{
 assert.equal(clicksToMg(60,10),10);close(clicksToMg(22,10),3.6667,1e-4);
 assert.equal(toClicks(2.5,10),15);assert.equal(toClicks(99,5),60);assert.equal(toClicks(-1,5),0)});

test("glapp links: gaps become pauses, extras are reported",()=>{
 const q=new URLSearchParams("medication1=tirzepatide-injection&dose1=2.5&from1=1&to1=4&frequency1=7&medication2=tirzepatide-injection&dose2=5&from2=7&to2=8&frequency2=7&start_date=2026-01-05&length=10");
 const {state,notes}=fromGlappParams(q);
 assert.deepEqual(state.steps.map(s=>[s.dose,s.doses]),[[2.5,4],[0,2],[5,2]]);
 assert.equal(state.start,"2026-01-05");assert.equal(state.weeks,10);assert.deepEqual(notes,[]);
 assert.equal(fromGlappParams(new URLSearchParams("")),null)});
