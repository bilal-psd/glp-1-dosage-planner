// Pins the model so UI work can't drift the maths. Run: node --test
// Reference values were produced by the original inline model in index.html (commit 897be4a) before it moved to model.js.
import {test} from "node:test";
import assert from "node:assert/strict";
import {DRUGS,TIRZ,EXAMPLE,solveKa,doseEvents,simulate,amountBefore,layout,toClicks,clicksToMg,fromGlappParams} from "../model.js";

const close=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} ≉ ${b}`);
const kaOf=d=>solveKa(DRUGS[d].tmax,Math.LN2/DRUGS[d].halfLife);
const example=()=>{const steps=structuredClone(EXAMPLE.steps);layout(steps);return steps};

test("drug constants match glapp",()=>{
 assert.deepEqual(Object.fromEntries(Object.entries(DRUGS).map(([k,v])=>[k,[v.halfLife,v.bioavailability,v.volumeOfDistribution,v.tmax]])),{
  "tirzepatide-injection":[5,.8,10.3,1],"semaglutide-injection":[7,.89,12.5,1.5],"semaglutide-oral":[7,.01,12.5,.042],"retatrutide-injection":[6,.8,10,1.5]})});

test("ka solved from Tmax",()=>{
 close(kaOf(TIRZ),3.312189815390614,1e-9);
 close(kaOf("semaglutide-injection"),2.1513743053677667,1e-9);
 close(kaOf("retatrutide-injection"),2.024631145794553,1e-9);
 close(kaOf("semaglutide-oral"),178.61457705417584,1e-6)});

test("layout stacks step weeks",()=>{
 const s=example();assert.deepEqual(s.map(x=>[x.from,x.to]),[[1,7],[8,8],[9,9]]);assert.equal(layout(s),9)});

test("example dose days are end-exclusive: a 1-week step is one dose",()=>{
 const days=example().flatMap(s=>doseEvents(s,7,12)).map(e=>e.t);
 assert.deepEqual(days,[0,7,14,21,28,35,42,49,56])});

test("a 0 mg step is a pause",()=>{
 const s=[{dose:2.5,weeks:1},{dose:0,weeks:2},{dose:5,weeks:1}];layout(s);
 assert.deepEqual(s.flatMap(x=>doseEvents(x,7,12)).map(e=>e.t),[0,21])});

test("doses stop at the chart end",()=>{
 const s=[{dose:2.5,weeks:10}];layout(s);assert.equal(doseEvents(s[0],7,4).length,5)});

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
 assert.deepEqual(state.steps.map(s=>[s.dose,s.weeks]),[[2.5,4],[0,2],[5,2]]);
 assert.equal(state.start,"2026-01-05");assert.equal(state.weeks,10);assert.deepEqual(notes,[]);
 assert.equal(fromGlappParams(new URLSearchParams("")),null)});
