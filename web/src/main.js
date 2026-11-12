import { DiceTray } from './dice3d.js';
import {
  CATEGORIES, newSheet, scoreFor, applyScore, upperSum, bonus, total, isComplete, BONUS_THRESHOLD,
} from './rules.js';
import { chooseHolds, bestCategory } from './ai.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COLORS = ['var(--p1)', 'var(--p2)'];

let tray = null;
let G = null; // stan gry

function show(screen) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === screen));
}

function toast(text, ms = 1300) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), ms);
}

function modal(html, actions) {
  const m = $('modal');
  const card = $('modal-card');
  card.innerHTML = html + '<div class="btns"></div>';
  const box = card.querySelector('.btns');
  for (const [label, fn, cls] of actions) {
    const b = document.createElement('button');
    b.className = cls || 'big';
    b.textContent = label;
    b.onclick = () => { closeModal(); fn && fn(); };
    box.appendChild(b);
  }
  m.classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); }
const modalOpen = () => !$('modal').classList.contains('hidden');

const RULES_HTML = `
<h2>Zasady gry</h2>
<p>Każdy gracz w swojej turze ma do <b>3 rzutów</b> pięcioma kośćmi. Po rzucie dotknij kości, żeby ją
<b>zatrzymać</b> (trafia na półkę) – kolejny rzut losuje tylko pozostałe. Dotknij ponownie, żeby ją oddać.</p>
<p>Po rzutach musisz wpisać wynik do jednej wolnej rubryki (dotknij pola w tabeli i zatwierdź). Gra trwa 13 rund.</p>
<ul>
<li><b>Jedynki–Szóstki</b>: suma kości o danej wartości. Za co najmniej ${BONUS_THRESHOLD} pkt w tej części: <b>premia 35</b>.</li>
<li><b>Trzy / Cztery jednakowe</b>: suma wszystkich oczek.</li>
<li><b>Full</b> (3 + 2 jednakowe): 25 pkt.</li>
<li><b>Mały strit</b> (4 kolejne): 30 pkt, <b>Duży strit</b> (5 kolejnych): 40 pkt.</li>
<li><b>Pięć jednakowych</b>: 50 pkt, a każde kolejne: +50 premii.</li>
<li><b>Dowolne</b>: suma oczek.</li>
</ul>
<p>Jeśli układ nie pasuje do rubryki, wpisujesz 0. Wygrywa najwyższa suma.</p>`;

function newGame(vsCpu) {
  const n1 = ($('name1').value.trim() || 'Gracz 1');
  const n2 = vsCpu ? 'Komputer' : ($('name2').value.trim() || 'Gracz 2');
  G = {
    vsCpu,
    players: [
      { name: vsCpu ? (n1 === 'Gracz 1' ? 'Ty' : n1) : n1, sheet: newSheet(), cpu: false },
      { name: n2, sheet: newSheet(), cpu: vsCpu },
    ],
    cur: 0,
    round: 1,
    rollsLeft: 3,
    rolled: false,
    dice: [1, 1, 1, 1, 1],
    sel: null,
    busy: false,
    token: 0,
  };
  show('game');
  if (!tray) {
    tray = new DiceTray($('tray'));
    tray.onTap = onDieTap;
    window.__tray = tray;
  }
  startTurn(true);
}

function player() { return G.players[G.cur]; }

function startTurn(first) {
  G.rollsLeft = 3;
  G.rolled = false;
  G.sel = null;
  tray.releaseAll();
  render();
  const p = player();
  if (!first || G.vsCpu) toast(p.cpu ? 'Ruch komputera' : (G.vsCpu ? 'Twój ruch' : `Tura: ${p.name}`));
  if (p.cpu) runCpu(G.token);
}

async function doRoll() {
  if (G.busy || tray.rolling || G.rollsLeft <= 0) return;
  G.busy = true;
  G.sel = null;
  G.rollsLeft--;
  render();
  const vals = await tray.roll();
  if (!G) return;
  G.dice = vals;
  G.rolled = true;
  G.busy = false;
  render();
}

function onDieTap(i) {
  if (!G || G.busy || tray.rolling || player().cpu || !G.rolled || G.rollsLeft === 0) return;
  tray.setHeld(i, !tray.held[i]);
  render();
}

function onCellTap(id) {
  if (!G || G.busy || tray.rolling || player().cpu || !G.rolled) return;
  if (player().sheet[id] !== null) return;
  G.sel = G.sel === id ? null : id;
  render();
}

async function commit(id) {
  const p = player();
  const extra = applyScore(p.sheet, id, G.dice);
  G.justCell = { p: G.cur, id };
  G.sel = null;
  G.rolled = false;
  if (extra) toast('Kolejne pięć jednakowych! +50');
  render();
  G.busy = true;
  const token = G.token;
  await sleep(extra ? 1300 : 650);
  if (!G || token !== G.token) return;
  G.busy = false;
  G.justCell = null;
  if (G.players.every((pl) => isComplete(pl.sheet))) return endGame();
  G.cur = 1 - G.cur;
  if (G.cur === 0) G.round++;
  startTurn(false);
}

async function runCpu(token) {
  const alive = () => G && G.token === token;
  await sleep(900);
  for (let r = 0; r < 3; r++) {
    if (!alive()) return;
    await doRoll();
    if (!alive()) return;
    await sleep(600);
    if (G.rollsLeft === 0) break;
    const holds = chooseHolds(player().sheet, G.dice, G.rollsLeft);
    if (!holds) break;
    for (let i = 0; i < 5; i++) {
      if (holds[i] !== tray.held[i]) {
        tray.setHeld(i, holds[i]);
        render();
        await sleep(330);
        if (!alive()) return;
      }
    }
    await sleep(450);
  }
  if (!alive()) return;
  const { id } = bestCategory(player().sheet, G.dice);
  G.sel = id;
  render();
  await sleep(1000);
  if (!alive()) return;
  commit(id);
}

function endGame() {
  const res = G.players.map((p) => ({ name: p.name, t: total(p.sheet) }));
  const best = Math.max(...res.map((r) => r.t));
  const winners = res.filter((r) => r.t === best);
  let title;
  if (winners.length > 1) title = 'Remis!';
  else if (G.vsCpu) title = winners[0].name === 'Komputer' ? 'Komputer wygrywa' : 'Wygrałeś!';
  else title = `Wygrywa ${winners[0].name}!`;
  const rows = res.map((r) => `<div class="result ${r.t === best ? 'win' : ''}"><span>${esc(r.name)}</span><span>${r.t}</span></div>`).join('');
  const vs = G.vsCpu;
  modal(`<div class="trophy">🏆</div><h2 style="text-align:center">${esc(title)}</h2>${rows}`, [
    ['Rewanż', () => newGame(vs)],
    ['Menu', () => { G = null; show('menu'); }, 'ghost'],
  ]);
}

function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function render() {
  if (!G) return;
  const p = player();
  $('turn-name').textContent = p.cpu ? '🤖 Komputer' : (G.vsCpu ? `🎲 ${p.name}` : `🎲 ${p.name}`);
  $('turn-name').style.color = COLORS[G.cur];
  $('turn-round').textContent = `Runda ${Math.min(G.round, 13)} z 13`;
  $('scores-mini').innerHTML = G.players.map((pl, i) =>
    `<div class="${i === G.cur ? 'on' : ''}" style="color:${COLORS[i]}">${total(pl.sheet)}</div>`).join('');

  [...$('rolls').children].forEach((el, i) => el.classList.toggle('used', i >= G.rollsLeft));

  const btn = $('btn-roll');
  const hint = $('hint');
  btn.classList.remove('save');
  if (G.sel) {
    const v = scoreFor(G.sel, G.dice);
    const cat = CATEGORIES.find((c) => c.id === G.sel);
    btn.textContent = `Zapisz ${v}`;
    btn.classList.add('save');
    btn.disabled = p.cpu || G.busy;
    hint.textContent = `${cat.name}: ${v} pkt`;
  } else {
    btn.textContent = G.rollsLeft === 3 ? 'RZUĆ' : `RZUĆ (${G.rollsLeft})`;
    btn.disabled = p.cpu || G.busy || G.rollsLeft === 0;
    if (p.cpu) hint.textContent = 'Komputer myśli…';
    else if (G.busy) hint.textContent = '';
    else if (!G.rolled) hint.textContent = 'Rzuć kośćmi';
    else if (G.rollsLeft > 0) hint.textContent = 'Dotknij kości, by zatrzymać. Albo wybierz rubrykę.';
    else hint.textContent = 'Wybierz rubrykę w tabeli';
  }

  // tabela
  const pl = G.players;
  let h = `<tr><th>Rubryka</th>${pl.map((x, i) => `<th style="color:${COLORS[i]}">${esc(x.name)}</th>`).join('')}</tr>`;
  const cell = (pi, id) => {
    const s = pl[pi].sheet;
    const cls = ['val'];
    if (pi === G.cur) cls.push('cur');
    let txt = '';
    if (s[id] !== null) {
      txt = s[id];
      if (G.justCell && G.justCell.p === pi && G.justCell.id === id) cls.push('just');
    } else if (pi === G.cur && G.rolled) {
      const v = scoreFor(id, G.dice);
      txt = v;
      cls.push('preview');
      if (v === 0) cls.push('zero');
      if (G.sel === id) cls.push('sel');
    }
    return `<td class="${cls.join(' ')}" data-id="${pi === G.cur ? id : ''}">${txt}</td>`;
  };
  CATEGORIES.forEach((c, idx) => {
    if (idx === 6) {
      h += `<tr class="sum"><td class="name">Suma górna <small>/ ${BONUS_THRESHOLD}</small></td>${pl.map((x) => `<td class="val">${upperSum(x.sheet)}</td>`).join('')}</tr>`;
      h += `<tr class="sum"><td class="name">Premia</td>${pl.map((x) => `<td class="val">${bonus(x.sheet) || '–'}</td>`).join('')}</tr>`;
      h += '<tr class="gap"><td colspan="3"></td></tr>';
    }
    h += `<tr><td class="name">${c.name}<small>${c.hint}</small></td>${pl.map((_, i) => cell(i, c.id)).join('')}</tr>`;
  });
  if (pl.some((x) => x.sheet.extra)) {
    h += `<tr class="sum"><td class="name">Premia za kolejne 5</td>${pl.map((x) => `<td class="val">${x.sheet.extra || '–'}</td>`).join('')}</tr>`;
  }
  h += `<tr class="total"><td class="name">Razem</td>${pl.map((x) => `<td class="val">${total(x.sheet)}</td>`).join('')}</tr>`;
  $('sheet').innerHTML = h;
}

$('sheet').addEventListener('click', (e) => {
  const td = e.target.closest('td[data-id]');
  if (td && td.dataset.id) onCellTap(td.dataset.id);
});

$('btn-roll').onclick = () => {
  if (!G) return;
  if (G.sel) { if (!G.busy && !player().cpu) commit(G.sel); } else doRoll();
};

$('btn-pvp').onclick = () => newGame(false);
$('btn-cpu').onclick = () => newGame(true);
$('btn-rules').onclick = () => modal(RULES_HTML, [['OK', null]]);

function askQuit() {
  modal('<h2>Przerwać grę?</h2><p>Bieżąca rozgrywka zostanie utracona.</p>', [
    ['Wróć do gry', null],
    ['Wyjdź do menu', () => { G.token++; G = null; show('menu'); }, 'ghost'],
  ]);
}
$('btn-quit').onclick = askQuit;

// wywoływane przez przycisk "wstecz" w Androidzie; true = obsłużone
window.handleBack = () => {
  if (modalOpen()) { closeModal(); return true; }
  if (G) { askQuit(); return true; }
  return false;
};
