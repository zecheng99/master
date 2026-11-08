import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../amount-math.js', import.meta.url), 'utf8'), context);
const { evaluate } = context.SpendexAmount;

test('basic arithmetic, precedence and parentheses', () => {
  for (const [expression, expected] of [
    ['260-95-50', 115], ['10+20*3', 70], ['(10+20)*3', 90],
    ['100/4+5', 30], ['-5*-2', 10], ['2--3', 5], ['.5+.25', .75], [' 10 + 2 / 4 ', 10.5]
  ]) {
    const result = evaluate(expression);
    assert.equal(result.valid, true, expression);
    assert.equal(result.value, expected, expression);
  }
});

test('pasted math symbols and full-width input work', () => {
  for (const expression of ['（１０＋２０）×３÷２', '(10+20)x3/2', '（10＋20）＊3／2＝']) {
    assert.equal(evaluate(expression).value, 45);
  }
});

test('decimal calculations are exact before rounding to two decimal places', () => {
  for (const [expression, expected] of [
    ['0.1+0.2', '0.30'], ['1.005', '1.01'], ['2.675', '2.68'],
    ['1/3*3', '1.00'], ['10/3', '3.33'], ['-1.005', '-1.01'], ['0.004', '0.00']
  ]) assert.equal(evaluate(expression).formatted, expected, expression);
});

test('incomplete expressions, invalid syntax, code and division by zero are rejected', () => {
  for (const input of ['260-', '(1+2', '1 2', '2**3', '1..2', '()', '1/0', '5/(3-3)', '1;alert(1)', 'Math.random()', 'Infinity', 'NaN', '1e3', '1,000']) {
    assert.equal(evaluate(input).valid, false, input);
  }
  assert.match(evaluate('1/0').message, /除数/);
  assert.equal(evaluate('').empty, true);
  assert.equal(evaluate('1'.repeat(201)).valid, false);
  assert.equal(evaluate('9999999999999999999999999').valid, false);
});
