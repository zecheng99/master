(function (root) {
  'use strict';
  // Parse arithmetic as exact fractions; never execute input as JavaScript.
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a < 0n ? -a : a; };
  function fraction(n, d = 1n) {
    if (d < 0n) { n = -n; d = -d; }
    const factor = gcd(n, d);
    return { n: n / factor, d: d / factor };
  }
  function evaluate(input) {
    const original = String(input ?? '').trim();
    if (!original) return { valid: false, empty: true, message: '' };
    if (original.length > 200) return { valid: false, message: '算式过长，请分步计算' };
    const symbols = { '＋': '+', '－': '-', '−': '-', '×': '*', '＊': '*', x: '*', X: '*', '÷': '/', '／': '/', '（': '(', '）': ')', '．': '.', '＝': '=' };
    const text = original.replace(/[０-９]/g, char => String(char.charCodeAt(0) - 0xff10))
      .replace(/[＋－−×＊xX÷／（）．＝]/g, char => symbols[char]).replace(/=\s*$/, '');
    if (/[^\d\s.+\-*/()]/.test(text)) return { valid: false, message: '仅支持数字、加减乘除和括号' };
    let position = 0;
    const skip = () => { while (/\s/.test(text[position] || '') && position < text.length) position++; };
    const peek = () => { skip(); return text[position]; };
    function primary() {
      const char = peek();
      if (char === '+' || char === '-') {
        position++;
        const value = primary();
        return char === '-' ? { n: -value.n, d: value.d } : value;
      }
      if (char === '(') {
        position++;
        const value = sum();
        if (peek() !== ')') throw new Error('请补全括号');
        position++;
        return value;
      }
      const match = text.slice(position).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
      if (!match) throw new Error(char === undefined ? '请补全算式' : '算式格式不正确');
      position += match[0].length;
      const [whole, decimals = ''] = match[0].split('.');
      return fraction(BigInt((whole || '0') + decimals), 10n ** BigInt(decimals.length));
    }
    function product() {
      let value = primary();
      while (peek() === '*' || peek() === '/') {
        const operator = text[position++], next = primary();
        if (operator === '/') {
          if (next.n === 0n) throw new Error('除数不能为 0');
          value = fraction(value.n * next.d, value.d * next.n);
        } else value = fraction(value.n * next.n, value.d * next.d);
      }
      return value;
    }
    function sum() {
      let value = product();
      while (peek() === '+' || peek() === '-') {
        const operator = text[position++], next = product();
        value = fraction(value.n * next.d + (operator === '+' ? next.n : -next.n) * value.d, value.d * next.d);
      }
      return value;
    }
    try {
      const result = sum();
      if (peek() !== undefined) throw new Error('算式格式不正确');
      const negative = result.n < 0n, numerator = (negative ? -result.n : result.n) * 100n;
      let cents = numerator / result.d;
      if (numerator % result.d * 2n >= result.d) cents++;
      if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金额过大，请检查算式');
      const formatted = (negative && cents ? '-' : '') + (cents / 100n) + '.' + String(cents % 100n).padStart(2, '0');
      return { valid: true, value: Number(negative ? -cents : cents) / 100, formatted, expression: /[+\-*/()]/.test(text) };
    } catch (error) {
      return { valid: false, message: error.message };
    }
  }
  function update(id) {
    const input = document.getElementById(id), result = evaluate(input.value);
    const box = document.getElementById(id + '-calculation');
    const output = document.getElementById(id + '-result');
    const button = document.getElementById(id + '-use-result');
    const positive = result.valid && result.value > 0;
    box.hidden = !!result.empty || (positive && !result.expression);
    output.textContent = positive ? '= ' + result.formatted : (result.message || '金额须大于 0');
    box.classList.toggle('amount-error', !positive && !result.empty);
    button.hidden = !positive;
    input.setAttribute('aria-invalid', String(!positive && !result.empty));
    return result;
  }
  function useResult(id) {
    const result = update(id), input = document.getElementById(id);
    if (result.valid && result.value > 0) {
      input.value = result.formatted;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.focus({ preventScroll: true });
  }
  function onKey(event, id) {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); useResult(id); }
  }
  root.SpendexAmount = { evaluate, update, useResult, onKey };
})(globalThis);
