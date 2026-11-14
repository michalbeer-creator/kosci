import { DiceTray } from './dice3d.js';
import {
  CATEGORIES, newSheet, scoreFor, applyScore, upperSum, bonus, total, isComplete, BONUS_THRESHOLD,
} from './rules.js';
import { chooseHolds, bestCategory } from './ai.js';
import { net } from './net.js';

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
  beginGame({
    vsCpu,
    players: [
      { name: vsCpu ? (n1 === 'Gracz 1' ? 'Ty' : n1) : n1, sheet: newSheet(), cpu: false },
      { name: n2, sheet: newSheet(), cpu: vsCpu },
    ],
    first: 0,
  });
}

function beginGame(opts) {
  closeModal();
  G = {
    vsCpu: false,
    net: false,
    me: 0,
    first: 0,
    ...opts,
    cur: opts.first || 0,
    round: 1,
    rollsLeft: 3,
    rolled: false,
    dice: [1, 1, 1, 1, 1],
    sel: null,
    busy: false,
    token: 0,
    moves: 0,
  };
  show('game');
  if (!tray) {
    tray = new DiceTray($('tray'));
    tray.onTap = onDieTap;
    window.__tray = tray;
    window.__game = () => G;
  }
  startTurn(true);
}

function player() { return G.players[G.cur]; }
// czy ten telefon może teraz wykonać ruch (nie komputer, nie przeciwnik po drugiej stronie)
function myTurn() { return G && !player().cpu && !player().remote; }
function canAct() { return myTurn() && !G.busy && !G.paused && !tray.rolling; }
function sendNet(msg) { if (G && G.net) net.send({ ...msg, n: G.moves }); }

function startTurn(first) {
  G.rollsLeft = 3;
  G.rolled = false;
  G.sel = null;
  tray.releaseAll();
  render();
  const p = player();
  if (G.net) toast(p.remote ? `Ruch: ${p.name}` : 'Twój ruch');
  else if (!first || G.vsCpu) toast(p.cpu ? 'Ruch komputera' : (G.vsCpu ? 'Twój ruch' : `Tura: ${p.name}`));
  if (p.cpu) runCpu(G.token);
}

async function doRoll() {
  if (G.busy || G.paused || tray.rolling || G.rollsLeft <= 0) return;
  G.busy = true;
  G.sel = null;
  G.rollsLeft--;
  const token = G.token;
  sendNet({ t: 'roll', held: [...tray.held] });
  render();
  const vals = await tray.roll();
  if (!G || token !== G.token) return;
  G.dice = vals;
  G.rolled = true;
  G.busy = false;
  G.moves++;
  sendNet({ t: 'rolled', vals, rollsLeft: G.rollsLeft, held: [...tray.held] });
  render();
}

function onDieTap(i) {
  if (!G || !canAct() || !G.rolled || G.rollsLeft === 0) return;
  tray.setHeld(i, !tray.held[i]);
  G.moves++;
  sendNet({ t: 'hold', i, on: tray.held[i] });
  render();
}

function onCellTap(id) {
  if (!G || !canAct() || !G.rolled) return;
  if (player().sheet[id] !== null) return;
  G.sel = G.sel === id ? null : id;
  G.moves++;
  sendNet({ t: 'sel', id: G.sel });
  render();
}

async function commit(id) {
  if (myTurn()) { G.moves++; sendNet({ t: 'commit', id }); }
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
  if (G.cur === G.first) G.round++;
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
  else if (G.net) title = res[G.me].t === best ? 'Wygrałeś!' : `Wygrywa ${winners[0].name}`;
  else title = `Wygrywa ${winners[0].name}!`;
  const rows = res.map((r) => `<div class="result ${r.t === best ? 'win' : ''}"><span>${esc(r.name)}</span><span>${r.t}</span></div>`).join('');
  const vs = G.vsCpu;
  G.over = true;
  if (G.net) {
    modal(`<div class="trophy">🏆</div><h2 style="text-align:center">${esc(title)}</h2>${rows}`, [
      ['Rewanż', askRematch],
      ['Menu', leaveNetGame, 'ghost'],
    ]);
    return;
  }
  modal(`<div class="trophy">🏆</div><h2 style="text-align:center">${esc(title)}</h2>${rows}`, [
    ['Rewanż', () => newGame(vs)],
    ['Menu', () => { G = null; show('menu'); }, 'ghost'],
  ]);
}

function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function render() {
  if (!G) return;
  const p = player();
  $('turn-name').textContent = p.cpu ? '🤖 Komputer' : (p.remote ? `📡 ${p.name}` : `🎲 ${p.name}`);
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
    btn.disabled = !myTurn() || G.busy || G.paused;
    hint.textContent = p.remote ? `${p.name} wybiera: ${cat.name} (${v})` : `${cat.name}: ${v} pkt`;
  } else {
    btn.textContent = G.rollsLeft === 3 ? 'RZUĆ' : `RZUĆ (${G.rollsLeft})`;
    btn.disabled = !myTurn() || G.busy || G.paused || G.rollsLeft === 0;
    if (G.paused) hint.textContent = 'Brak połączenia…';
    else if (p.cpu) hint.textContent = 'Komputer myśli…';
    else if (p.remote) hint.textContent = `Czekaj, rzuca ${p.name}…`;
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
  if (!canAct()) return;
  if (G.sel) commit(G.sel); else doRoll();
};

$('btn-pvp').onclick = () => newGame(false);
$('btn-cpu').onclick = () => newGame(true);
$('btn-rules').onclick = () => modal(RULES_HTML, [['OK', null]]);

function askQuit() {
  modal('<h2>Przerwać grę?</h2><p>Bieżąca rozgrywka zostanie utracona.</p>', [
    ['Wróć do gry', null],
    ['Wyjdź do menu', () => { if (G.net) return leaveNetGame(); G.token++; G = null; show('menu'); }, 'ghost'],
  ]);
}
$('btn-quit').onclick = askQuit;

// wywoływane przez przycisk "wstecz" w Androidzie; true = obsłużone
window.handleBack = () => {
  if (modalOpen()) {
    if (lobby || (G && (G.paused || G.over))) return true; // te okna zamyka się przyciskiem
    closeModal(); return true;
  }
  if (G) { askQuit(); return true; }
  return false;
};

// ======================= GRA NA DWÓCH TELEFONACH (Nearby) =======================

const SEP = '|';
let lobby = null;        // { role: 'host'|'join', name, found: Map, connecting }
let netQueue = Promise.resolve();
let rejoinTimer = null;
const myPid = Math.random().toString(36).slice(2, 10);

const cleanName = (s) => (s || '').replace(/[|<>]/g, '').trim().slice(0, 12);
const myName = () => cleanName($('name1').value) || 'Gracz';
const shownName = (adv) => adv.split(SEP)[0];

function netError(text) {
  modal(`<h2>Gra na dwóch telefonach</h2><p>${text}</p>`, [['OK', null]]);
}

function openNetMenu() {
  if (!net.available()) {
    return netError('Ta opcja działa tylko w aplikacji na Androidzie.');
  }
  if (!net.status().gms) {
    return netError('Ten telefon nie ma Usług Google Play, które są potrzebne do gry na dwóch telefonach.');
  }
  modal(`<h2>📡 Gra na dwóch telefonach</h2>
    <p>Na obu telefonach włącz <b>Bluetooth</b> i <b>Wi-Fi</b> (internet nie jest potrzebny).
    Jeden telefon zakłada grę, drugi do niej dołącza.</p>
    <p class="muted">Grasz jako: <b>${esc(myName())}</b> (imię zmienisz w menu, pole „Gracz 1”).</p>`, [
    ['Załóż grę', startHosting],
    ['Dołącz do gry', startJoining],
    ['Anuluj', null, 'ghost'],
  ]);
}

function lobbyView() {
  if (!lobby) return;
  const cancel = ['Anuluj', cancelLobby, 'ghost'];
  if (lobby.connecting) {
    modal(`<h2>Łączenie…</h2><p>Łączę z: <b>${esc(lobby.connecting)}</b></p><div class="spinner"></div>`, [cancel]);
  } else if (lobby.role === 'host') {
    modal(`<h2>Czekam na drugiego gracza</h2>
      <p>Twoja gra: <b>${esc(lobby.name)}</b></p>
      <p>Na drugim telefonie wybierz <b>📡 Gra na dwóch telefonach → Dołącz do gry</b>.</p>
      <div class="spinner"></div>`, [cancel]);
  } else {
    const items = [...lobby.found.entries()];
    modal(`<h2>Gry w pobliżu</h2>
      ${items.length ? '<p>Dotknij gry, żeby dołączyć:</p>' : '<p>Szukam… Upewnij się, że drugi telefon założył grę.</p><div class="spinner"></div>'}
      <div class="found-list"></div>`, [cancel]);
    const box = $('modal-card').querySelector('.found-list');
    for (const [id, adv] of items) {
      const b = document.createElement('button');
      b.className = 'big found';
      b.textContent = `🎲 ${shownName(adv)}`;
      b.onclick = () => {
        lobby.connecting = shownName(adv);
        lobby.target = adv;
        lobbyView();
        net.connect(id, myName() + SEP + myPid);
      };
      box.appendChild(b);
    }
  }
}

function startHosting() {
  lobby = { role: 'host', name: myName(), found: new Map() };
  lobby.adv = lobby.name + SEP + myPid;
  lobbyView();
  net.host(lobby.adv);
}

function startJoining() {
  lobby = { role: 'join', name: myName(), found: new Map() };
  lobbyView();
  net.join(myName() + SEP + myPid);
}

function cancelLobby() {
  lobby = null;
  net.stop();
  closeModal();
}

function beginNetGame(names, first, me, peerPid) {
  lobby = null;
  netQueue = Promise.resolve();
  beginGame({
    net: true,
    me,
    first,
    peerPid,
    players: names.map((name, i) => ({ name, sheet: newSheet(), cpu: false, remote: i !== me })),
  });
}

// --- zdarzenia z Nearby ---
net.on((ev) => {
  switch (ev.type) {
    case 'found':
      if (G && G.net && G.paused && G.me === 1) {
        // ponowne łączenie: szukamy tego samego hosta
        if (ev.name.split(SEP)[1] === G.peerPid && !G.reconnecting) {
          G.reconnecting = true;
          net.connect(ev.id, G.players[G.me].name + SEP + myPid);
        }
        return;
      }
      if (lobby && lobby.role === 'join') { lobby.found.set(ev.id, ev.name); if (!lobby.connecting) lobbyView(); }
      break;
    case 'lost':
      if (lobby && lobby.found.delete(ev.id) && !lobby.connecting) lobbyView();
      break;
    case 'connecting':
      if (lobby && lobby.role === 'host' && !lobby.connecting) { lobby.connecting = shownName(ev.name); lobbyView(); }
      break;
    case 'connected':
      net.send({ t: 'hello', v: 1, name: G && G.net ? G.players[G.me].name : myName(), pid: myPid, inGame: !!(G && G.net) });
      break;
    case 'connect-failed':
      if (G && G.net && G.paused) { G.reconnecting = false; scheduleRejoin(); return; }
      if (lobby) {
        lobby.connecting = null;
        lobbyView();
        toast('Nie udało się połączyć. Spróbuj ponownie.', 2200);
        if (lobby.role === 'host') net.host(lobby.adv);
      }
      break;
    case 'disconnected':
      onDisconnected();
      break;
    case 'permission-denied':
      lobby = null;
      modal(`<h2>Brak uprawnień</h2><p>Bez zgody na <b>urządzenia w pobliżu</b> (Bluetooth / Wi-Fi${
        ev.permanent ? '' : ', a na starszych Androidach lokalizację'}) gra na dwóch telefonach nie zadziała.</p>`,
      ev.permanent
        ? [['Otwórz ustawienia', () => net.openSettings()], ['Anuluj', null, 'ghost']]
        : [['Spróbuj jeszcze raz', openNetMenu], ['Anuluj', null, 'ghost']]);
      break;
    case 'error':
      if (ev.where === 'send') return;
      if (G && G.net && G.paused) { G.reconnecting = false; scheduleRejoin(); return; }
      lobby = null;
      net.stop();
      netError(`Nie udało się ${ev.where === 'advertise' ? 'założyć gry' : ev.where === 'discover' ? 'wyszukać gier' : 'połączyć'}.
        Sprawdź, czy Bluetooth, Wi-Fi i lokalizacja są włączone.<br><small class="muted">(${esc(String(ev.message))})</small>`);
      break;
    case 'message':
      onNetMessage(ev.data);
      break;
    default:
  }
});

function onNetMessage(m) {
  if (m.t === 'hello') {
    if (G && G.net) {
      if (m.pid !== G.peerPid) { net.stop(); scheduleRejoin(); return; } // ktoś obcy – czekamy na naszego gracza
      reconnected();
      return;
    }
    if (lobby && lobby.role === 'host') {
      const first = 0;
      const names = [lobby.name, cleanName(m.name) || 'Gość'];
      net.send({ t: 'start', names, first, pid: myPid });
      beginNetGame(names, first, 0, m.pid);
    }
    return;
  }
  if (m.t === 'start') {
    if (G && G.net && !G.over) return;
    beginNetGame(m.names, m.first, 1, m.pid);
    return;
  }
  if (!G || !G.net) return;
  if (m.t === 'bye') {
    const who = G.players[1 - G.me].name;
    G.token++;
    G.left = true;
    net.stop();
    modal(`<h2>Koniec gry</h2><p><b>${esc(who)}</b> opuścił grę.</p>`, [['Menu', () => { G = null; show('menu'); }]]);
    return;
  }
  if (m.t === 'rematch') {
    G.peerRematch = true;
    if (!G.wantRematch) toast('Przeciwnik chce rewanżu', 2500);
    tryRematch();
    return;
  }
  // ruchy gry wykonujemy po kolei – animacje nie mogą na siebie nachodzić
  netQueue = netQueue.then(() => applyRemote(m)).catch((e) => console.error(e));
}

async function applyRemote(m) {
  if (!G || !G.net) return;
  const remoteTurn = player().remote;
  switch (m.t) {
    case 'roll': {
      if (!remoteTurn) return;
      syncHeld(m.held);
      G.busy = true;
      G.sel = null;
      G.rollsLeft = Math.max(0, G.rollsLeft - 1);
      render();
      await tray.roll();
      break;
    }
    case 'rolled': {
      if (!remoteTurn) return;
      while (tray.rolling) await sleep(50);
      syncHeld(m.held);
      for (let i = 0; i < 5; i++) if (!tray.held[i]) tray.faceUp(i, m.vals[i], 280);
      await sleep(320);
      if (!G) return;
      G.dice = m.vals;
      G.rollsLeft = m.rollsLeft;
      G.rolled = true;
      G.busy = false;
      G.moves++;
      render();
      break;
    }
    case 'hold':
      if (!remoteTurn) return;
      tray.setHeld(m.i, m.on);
      G.moves++;
      render();
      await sleep(270);
      break;
    case 'sel':
      if (!remoteTurn) return;
      G.sel = m.id;
      G.moves++;
      render();
      break;
    case 'commit':
      if (!remoteTurn) return;
      G.moves++;
      await commit(m.id);
      break;
    case 'sync':
      await waitIdle();
      if (G && m.moves > G.moves) adoptState(m.state, m.moves);
      break;
    default:
  }
}

function syncHeld(held) {
  if (!held) return;
  for (let i = 0; i < 5; i++) if (tray.held[i] !== held[i]) tray.setHeld(i, held[i]);
}

async function waitIdle() {
  while (G && (G.busy || tray.rolling)) await sleep(100);
}

function snapshot() {
  return {
    sheets: G.players.map((p) => p.sheet),
    cur: G.cur, round: G.round, rollsLeft: G.rollsLeft, rolled: G.rolled,
    dice: G.dice, held: [...tray.held], sel: G.sel,
  };
}

function adoptState(st, moves) {
  G.token++;
  st.sheets.forEach((sh, i) => { G.players[i].sheet = sh; });
  Object.assign(G, { cur: st.cur, round: st.round, rollsLeft: st.rollsLeft, rolled: st.rolled, dice: st.dice, sel: st.sel });
  G.moves = moves;
  G.busy = false;
  G.justCell = null;
  tray.setState(st.dice, st.held);
  render();
  if (G.players.every((pl) => isComplete(pl.sheet))) endGame();
}

// --- zerwane połączenie ---
function onDisconnected() {
  if (lobby) {
    lobby.connecting = null;
    lobbyView();
    if (lobby.role === 'host') net.host(lobby.adv);
    return;
  }
  if (!G || !G.net || G.left) return;
  if (G.over) { toast('Połączenie zerwane', 2500); return; }
  G.paused = true;
  G.reconnecting = false;
  render();
  const other = G.players[1 - G.me].name;
  modal(`<h2>Połączenie zerwane</h2>
    <p>Straciłem kontakt z telefonem: <b>${esc(other)}</b>. Próbuję połączyć ponownie…</p>
    <p class="muted">Telefony powinny być blisko siebie, z włączonym Bluetooth i Wi-Fi. Wynik jest zapamiętany.</p>
    <div class="spinner"></div>`, [['Zakończ grę', leaveNetGame, 'ghost']]);
  rejoin();
}

function rejoin() {
  clearTimeout(rejoinTimer);
  if (!G || !G.paused) return;
  if (G.me === 0) net.host(G.players[0].name + SEP + myPid);
  else net.join(G.players[1].name + SEP + myPid);
}

function scheduleRejoin() {
  clearTimeout(rejoinTimer);
  rejoinTimer = setTimeout(() => { net.stopSearch(); rejoin(); }, 2500);
}

async function reconnected() {
  clearTimeout(rejoinTimer);
  if (!G) return;
  G.paused = false;
  G.reconnecting = false;
  closeModal();
  toast('Połączono ponownie', 1800);
  render();
  await waitIdle();
  if (G && G.net) net.send({ t: 'sync', moves: G.moves, state: snapshot() });
}

// --- wyjście i rewanż ---
function leaveNetGame() {
  clearTimeout(rejoinTimer);
  if (G) { G.token++; sendNet({ t: 'bye' }); }
  setTimeout(() => net.stop(), 300); // daj czas na wysłanie „bye”
  G = null;
  closeModal();
  show('menu');
}

function askRematch() {
  if (!G) return;
  G.wantRematch = true;
  sendNet({ t: 'rematch' });
  if (!G.peerRematch) {
    modal('<h2>Rewanż</h2><p>Czekam, aż przeciwnik też wybierze „Rewanż”…</p><div class="spinner"></div>',
      [['Menu', leaveNetGame, 'ghost']]);
  }
  tryRematch();
}

function tryRematch() {
  if (!G || !G.wantRematch || !G.peerRematch || G.me !== 0) return;
  const names = G.players.map((p) => p.name);
  const first = 1 - G.first; // zaczyna na zmianę
  net.send({ t: 'start', names, first, pid: myPid });
  beginNetGame(names, first, 0, G.peerPid);
}

$('btn-net').onclick = openNetMenu;
