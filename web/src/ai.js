import { CATEGORIES, UPPER_IDS, scoreFor, upperSum, BONUS_THRESHOLD } from './rules.js';

// Przybliżona "typowa" wartość rubryki: koszt jej zużycia.
const BASELINE = {
  c1: 2, c2: 5, c3: 8, c4: 11, c5: 14, c6: 17,
  tri: 15, four: 7, full: 10, small: 14, large: 9, five: 4, any: 21,
};

function openCats(sheet) {
  return CATEGORIES.filter((c) => sheet[c.id] === null).map((c) => c.id);
}

// Ocena wpisania kości do rubryki (z uwzględnieniem premii za górną część).
function value(sheet, id, dice) {
  const s = scoreFor(id, dice);
  let v = s - BASELINE[id] * 0.85;
  if (UPPER_IDS.includes(id)) {
    const face = Number(id[1]);
    const need = face * 3;
    // wynik >= 3x wartość utrzymuje kurs na premię
    v += (s - need) * 0.6;
    const up = upperSum(sheet);
    if (up < BONUS_THRESHOLD && up + s >= BONUS_THRESHOLD) v += 30;
  }
  if (id === 'five' && s === 50) v += 20;
  if (id === 'any') v -= 4; // trzymaj "Dowolne" na później
  return v;
}

export function bestCategory(sheet, dice) {
  let best = null, bestV = -Infinity;
  for (const id of openCats(sheet)) {
    const v = value(sheet, id, dice);
    if (v > bestV) { bestV = v; best = id; }
  }
  return { id: best, v: bestV };
}

const rnd = () => 1 + Math.floor(Math.random() * 6);

// Wartość oczekiwana zatrzymania maski przy rollsLeft pozostałych rzutach.
function evalHold(sheet, dice, mask, rollsLeft, samples) {
  let total = 0;
  const d = dice.slice();
  for (let s = 0; s < samples; s++) {
    for (let i = 0; i < 5; i++) d[i] = mask & (1 << i) ? dice[i] : rnd();
    if (rollsLeft > 1) {
      // druga faza: zachłanny wybór maski na mniejszej próbie
      let bestInner = -Infinity;
      for (const m2 of candidateMasks(d)) {
        const e = evalHold(sheet, d, m2, rollsLeft - 1, 12);
        if (e > bestInner) bestInner = e;
      }
      total += Math.max(bestInner, bestCategory(sheet, d).v);
    } else {
      total += bestCategory(sheet, d).v;
    }
  }
  return total / samples;
}

// Ograniczony zbiór sensownych masek (żeby było szybko na telefonie).
function candidateMasks(dice) {
  const set = new Set([0]);
  // zatrzymaj wszystkie kości o danej wartości
  for (let v = 1; v <= 6; v++) {
    let m = 0;
    dice.forEach((d, i) => { if (d === v) m |= 1 << i; });
    if (m) set.add(m);
  }
  // zatrzymaj unikalne wartości tworzące ciąg
  for (const run of [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6], [2, 3, 4], [3, 4, 5], [1, 2, 3, 4, 5], [2, 3, 4, 5, 6]]) {
    let m = 0;
    for (const v of run) {
      const i = dice.findIndex((d, j) => d === v && !(m & (1 << j)));
      if (i >= 0) m |= 1 << i;
    }
    set.add(m);
  }
  // pary + trójki (full)
  const c = [0, 0, 0, 0, 0, 0, 0];
  dice.forEach((d) => c[d]++);
  let m2 = 0;
  dice.forEach((d, i) => { if (c[d] >= 2) m2 |= 1 << i; });
  if (m2) set.add(m2);
  // wysokie kości (szansa)
  let mh = 0;
  dice.forEach((d, i) => { if (d >= 5) mh |= 1 << i; });
  if (mh) set.add(mh);
  set.add(31);
  return [...set];
}

// Zwraca tablicę bool "zatrzymaj" albo null, jeśli komputer kończy rzucanie.
export function chooseHolds(sheet, dice, rollsLeft) {
  const stopV = bestCategory(sheet, dice).v;
  let bestMask = 31, bestV = stopV;
  for (const m of candidateMasks(dice)) {
    if (m === 31) continue;
    const e = evalHold(sheet, dice, m, rollsLeft, rollsLeft > 1 ? 40 : 300);
    if (e > bestV + 0.5) { bestV = e; bestMask = m; }
  }
  if (bestMask === 31) return null;
  return dice.map((_, i) => !!(bestMask & (1 << i)));
}
