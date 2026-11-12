// Zasady gry "Kościany Turniej": 5 kości, do 3 rzutów na turę, 13 rubryk.

export const CATEGORIES = [
  { id: 'c1', name: 'Jedynki', upper: 1, hint: 'suma jedynek' },
  { id: 'c2', name: 'Dwójki', upper: 2, hint: 'suma dwójek' },
  { id: 'c3', name: 'Trójki', upper: 3, hint: 'suma trójek' },
  { id: 'c4', name: 'Czwórki', upper: 4, hint: 'suma czwórek' },
  { id: 'c5', name: 'Piątki', upper: 5, hint: 'suma piątek' },
  { id: 'c6', name: 'Szóstki', upper: 6, hint: 'suma szóstek' },
  { id: 'tri', name: 'Trzy jednakowe', hint: 'suma oczek' },
  { id: 'four', name: 'Cztery jednakowe', hint: 'suma oczek' },
  { id: 'full', name: 'Full', hint: '3+2, 25 pkt' },
  { id: 'small', name: 'Mały strit', hint: '4 po kolei, 30 pkt' },
  { id: 'large', name: 'Duży strit', hint: '5 po kolei, 40 pkt' },
  { id: 'five', name: 'Pięć jednakowych', hint: '50 pkt' },
  { id: 'any', name: 'Dowolne', hint: 'suma oczek' },
];

export const UPPER_IDS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
export const BONUS_THRESHOLD = 63;
export const BONUS_VALUE = 35;
export const FIVE_EXTRA = 50; // premia za każde kolejne "Pięć jednakowych"

function counts(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
}

const sum = (dice) => dice.reduce((a, b) => a + b, 0);

function hasRun(c, len) {
  let run = 0;
  for (let v = 1; v <= 6; v++) {
    run = c[v] ? run + 1 : 0;
    if (run >= len) return true;
  }
  return false;
}

export function scoreFor(id, dice) {
  const c = counts(dice);
  const max = Math.max(...c);
  switch (id) {
    case 'c1': case 'c2': case 'c3': case 'c4': case 'c5': case 'c6': {
      const v = Number(id[1]);
      return c[v] * v;
    }
    case 'tri': return max >= 3 ? sum(dice) : 0;
    case 'four': return max >= 4 ? sum(dice) : 0;
    case 'full': return (c.includes(3) && c.includes(2)) || max === 5 ? 25 : 0;
    case 'small': return hasRun(c, 4) ? 30 : 0;
    case 'large': return hasRun(c, 5) ? 40 : 0;
    case 'five': return max === 5 ? 50 : 0;
    case 'any': return sum(dice);
  }
  return 0;
}

export function newSheet() {
  const s = {};
  for (const cat of CATEGORIES) s[cat.id] = null;
  s.extra = 0;
  return s;
}

export function upperSum(sheet) {
  return UPPER_IDS.reduce((a, id) => a + (sheet[id] ?? 0), 0);
}

export function bonus(sheet) {
  return upperSum(sheet) >= BONUS_THRESHOLD ? BONUS_VALUE : 0;
}

export function total(sheet) {
  let t = bonus(sheet) + sheet.extra;
  for (const cat of CATEGORIES) t += sheet[cat.id] ?? 0;
  return t;
}

export function isComplete(sheet) {
  return CATEGORIES.every((c) => sheet[c.id] !== null);
}

// Zapis wyniku; zwraca premię za kolejne "Pięć jednakowych" (0 lub 50).
export function applyScore(sheet, id, dice) {
  let extra = 0;
  if (sheet.five === 50 && Math.max(...counts(dice)) === 5) {
    extra = FIVE_EXTRA;
    sheet.extra += extra;
  }
  sheet[id] = scoreFor(id, dice);
  return extra;
}
