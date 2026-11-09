import assert from 'node:assert/strict';
import {countdown,todayInSingapore,seedTitles,homeSections,groupWishes,getCategory,isInProgress,canPin,wishUnit} from '../src/year.ts';
for(const [instant,remaining,before,ended] of [
 ['2026-11-07T15:59:59Z',365,true,false],
 ['2026-11-07T16:00:00Z',365,false,false],
 ['2026-11-08T16:00:00Z',364,false,false],
 ['2027-11-06T16:00:00Z',1,false,false],
 ['2027-11-07T15:59:59Z',1,false,false],
 ['2027-11-07T16:00:00Z',0,false,true]]){
 const c=countdown(new Date(instant));assert.equal(c.remaining,remaining);assert.equal(c.before,before);assert.equal(c.ended,ended);
}
assert.equal(countdown(new Date('2026-11-07T15:59:59Z')).untilStart,1);
assert.equal(todayInSingapore(new Date('2026-11-08T23:00:00-08:00')),'2026-11-09');
assert.equal(seedTitles.length,11);assert.equal(seedTitles[7],'上30节健身课');
console.log('PASS: inclusive day count, midnight boundaries, fixed timezone, and 11 seeds');

const wish=(id,extra={})=>({id,title:'心愿'+id,target:null,progress:0,completed:0,completed_on:null,position:0,...extra});
const sample=[wish('next',{pinned:1}),wish('voice',{title:'上15节声乐课',target:15,progress:7}),wish('gym',{title:'上30节健身课',target:30,progress:1,pinned:1}),wish('done',{target:3,progress:3,completed:1,pinned:1}),wish('zero',{target:4,progress:0})];
assert.deepEqual(homeSections(sample).pinned.map(w=>w.id),['next']);assert.deepEqual(homeSections(sample).ongoing.map(w=>w.id),['voice','gym']);
assert.equal(isInProgress(sample[4]),false);assert.equal(canPin(sample[2]),false);assert.equal(canPin(sample[3]),false);
assert.equal(getCategory({title:'去柳州'}),'旅行与户外');assert.equal(getCategory({title:'上15节声乐课'}),'学习与成长');assert.equal(getCategory({title:'上30节健身课'}),'运动与健康');assert.equal(getCategory({title:'决定学东京8平米，尽量在外面过日子'}),'日常生活');
assert.equal(getCategory({title:'去柳州',category:'学习与成长'}),'学习与成长');
assert.deepEqual(groupWishes(sample).map(g=>g.category),['学习与成长','运动与健康','日常生活']);
assert.equal(homeSections(Array.from({length:9},(_,i)=>wish(String(i),{pinned:1}))).pinned.length,7);
assert.equal(wishUnit('上15节声乐课'),'节');assert.equal(wishUnit('徒步'),'次');
console.log('PASS: home sections, no duplicates, count lifecycle, legacy category fallback, grouped library and course units');
