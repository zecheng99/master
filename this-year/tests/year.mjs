import assert from 'node:assert/strict';
import {countdown,todayInSingapore,seedTitles} from '../src/year.ts';
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
