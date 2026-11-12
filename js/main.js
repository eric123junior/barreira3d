import { newState, applyAction, isLegal, pawnMoves, checkWall, replay, pathLength, wallSet, goalRow, exitRow, WALLS_PER_PLAYER } from './rules.js';
import { GameScene } from './scene.js';
import { Net, randomRoomCode } from './net.js';
import { chooseAction } from './ai.js';

const $ = id => document.getElementById(id);
const scene = new GameScene($('game'));

// ---------- Som ----------
let audio = null, soundOn = true;
function beep(freqs, dur = 0.12, type = 'sine', vol = 0.15) {
  if (!soundOn) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    let t = audio.currentTime;
    for (const f of freqs) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t); o.stop(t + dur);
      t += dur * 0.8;
    }
  } catch {}
}
const sfx = {
  move: () => beep([520, 700], 0.09, 'triangle'),
  wall: () => beep([160, 110], 0.14, 'square', 0.08),
  bad: () => beep([220, 180], 0.12, 'sawtooth', 0.06),
  win: () => beep([523, 659, 784, 1046], 0.16, 'triangle', 0.18),
  lose: () => beep([392, 330, 262], 0.2, 'triangle', 0.14),
  join: () => beep([660, 880], 0.1, 'sine'),
};

// ---------- Estado da aplicação ----------
const app = {
  mode: 'menu',        // menu | tutorial | local | bot | online
  state: newState(0),
  seats: [],           // assentos controlados por este aparelho
  names: ['Azul', 'Vermelho'],
  tool: 'move',
  orient: 'h',
  pending: null,       // muro aguardando 2º toque (celular)
  lastPick: null,
};

function toast(msg, bad = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  clearTimeout(toast.tm);
  toast.tm = setTimeout(() => t.classList.remove('show'), 2400);
}

function show(id, on = true) { $(id).classList.toggle('hidden', !on); }
function showScreen(id) {
  for (const s of ['menu', 'botMenu', 'lobby', 'endScreen']) show(s, s === id);
  const inGame = !id || id === 'endScreen';
  show('hud', inGame); show('topbtns', inGame); show('actions', inGame);
}

const canAct = () => app.mode !== 'menu' && app.state.winner < 0 && app.seats.includes(app.state.turn) && !(app.mode === 'tutorial' && tutorial.locked);

// ---------- Interface ----------
function refresh() {
  const s = app.state;
  for (let p = 0; p < 2; p++) {
    $('name' + p).textContent = app.names[p];
    const b = $('bricks' + p);
    b.innerHTML = '';
    for (let i = 0; i < WALLS_PER_PLAYER; i++) {
      const el = document.createElement('i');
      if (i >= s.wallsLeft[p]) el.className = 'used';
      b.appendChild(el);
    }
    $('card' + p).classList.toggle('active', s.winner < 0 && s.turn === p);
  }
  let turnTxt;
  if (s.winner >= 0) turnTxt = 'Fim de jogo';
  else if (app.mode === 'local') turnTxt = 'Vez do ' + app.names[s.turn];
  else if (app.seats.includes(s.turn)) turnTxt = 'Sua vez!';
  else turnTxt = app.mode === 'bot' ? 'Robô pensando…' : 'Vez do oponente';
  $('turn').textContent = turnTxt;
  $('turn').style.background = s.winner >= 0 ? '' : (s.turn === 0 ? 'var(--blue)' : 'var(--red)');

  const mine = canAct();
  $('toolWall').disabled = !mine || s.wallsLeft[s.turn] <= 0;
  $('toolMove').disabled = !mine;
  $('btnRotate').disabled = !mine || app.tool !== 'wall';
  if (app.tool === 'wall' && s.wallsLeft[s.turn] <= 0) app.tool = 'move';
  $('toolMove').classList.toggle('active', app.tool === 'move');
  $('toolWall').classList.toggle('active', app.tool === 'wall');
  $('btnRotate').textContent = app.orient === 'h' ? '↻ Girar ⟷' : '↻ Girar ↕';

  if (mine && app.tool === 'move') {
    const moves = pawnMoves(s, s.turn).filter(m => tutorial.allowMove(m));
    scene.showMoves(moves, m => m.kind !== 'step');
  } else scene.showMoves([]);
  if (!mine || app.tool !== 'wall') { app.pending = null; if (!(tutorial.active() && tutorial.step()?.demo)) scene.showGhost(null); }
  else if (app.pending) showPending();
  else if (app.lastPick && !isTouch) updateGhost(app.lastPick);
  else scene.showGhost(null);

  // Barra de confirmação do muro
  const wallMode = mine && app.tool === 'wall';
  show('wallBar', wallMode);
  if (wallMode) {
    const chk = app.pending ? wallCheck(app.pending) : null;
    $('wallMsg').textContent = !app.pending ? (isTouch ? 'Toque entre as casas para escolher o lugar' : 'Clique entre as casas para escolher o lugar')
      : chk.ok ? 'Muro aqui? Toque em ✔ para colocar' : chk.reason;
    $('wallMsg').classList.toggle('bad', !!app.pending && !chk.ok);
    $('btnConfirmWall').disabled = !app.pending || !chk.ok;
  }

  let hint = '';
  if (mine && app.tool === 'move') hint = isTouch ? 'Toque numa casa brilhante para andar • toque na pilha de muros para pegar um muro'
    : 'Clique numa casa brilhante ou use as setas ⬆⬇⬅➡ • clique na pilha de muros para pegar um';
  if (!mine && app.mode === 'online' && s.winner < 0) hint = 'Aguardando a jogada do oponente…';
  if (!mine && app.mode === 'bot' && s.winner < 0) hint = '🤖 O Robô está pensando…';
  $('hint').textContent = hint;
}

function setTool(t) {
  if (!canAct()) return;
  if (t === 'wall' && app.state.wallsLeft[app.state.turn] <= 0) { toast('Você não tem mais muros.', true); return; }
  app.tool = t;
  app.pending = null;
  scene.setHover(null);
  refresh();
}
function rotate() {
  app.orient = app.orient === 'h' ? 'v' : 'h';
  if (app.pending) app.pending = wallAt(app.pending.r, app.pending.c, app.orient);
  refresh();
}

// Muro na âncora (r,c). Deitado pode ir na beira da chegada (pedra, r = -1 ou 8); em pé só dentro do tabuleiro.
function wallAt(r, c, o) {
  r = o === 'h' ? Math.min(8, Math.max(-1, r)) : Math.min(7, Math.max(0, r));
  return { k: 'w', r, c: Math.min(7, Math.max(0, c)), o };
}

function wallCheck(w) {
  const chk = checkWall(app.state, app.state.turn, w);
  if (chk.ok && !tutorial.allowWall(w)) return { ok: false, reason: tutorial.blockMsg() };
  return chk;
}

function showPending() {
  scene.showGhost(app.pending, wallCheck(app.pending).ok);
}

// Prévia do muro seguindo o mouse (só enquanto nenhum lugar foi escolhido)
function updateGhost(pick) {
  if (tutorial.active() && tutorial.step()?.demo) return;
  if (app.pending) { showPending(); return; }
  if (!pick || !canAct() || app.tool !== 'wall' || !pick.inBoard) { scene.showGhost(null); return; }
  const w = wallAt(pick.anchor.r, pick.anchor.c, app.orient);
  scene.showGhost(w, wallCheck(w).ok);
}

function choosePending(w) {
  app.pending = w;
  refresh();
}

function confirmWall() {
  if (!canAct() || app.tool !== 'wall' || !app.pending) return;
  const chk = wallCheck(app.pending);
  if (!chk.ok) { sfx.bad(); toast(chk.reason, true); return; }
  doAction({ ...app.pending });
}

function cancelWall() {
  if (app.pending) { app.pending = null; refresh(); }
  else setTool('move');
}

// Casa válida mais próxima de um ponto do tabuleiro
function nearestMove(pick, maxDist = 0.75) {
  let m = null, best = maxDist;
  for (const x of pawnMoves(app.state, app.state.turn)) {
    if (!tutorial.allowMove(x)) continue;
    const d = Math.hypot(x.r - pick.fr, x.c - pick.fc);
    if (d < best) { best = d; m = x; }
  }
  return m;
}

// Andar com as setas, de acordo com o lado de onde a câmera olha
function moveByKey(dr, dc) {
  if (scene.view === 1) { dr = -dr; dc = -dc; }
  const me = app.state.pawns[app.state.turn];
  const m = pawnMoves(app.state, app.state.turn).find(x =>
    Math.sign(x.r - me.r) === dr && Math.sign(x.c - me.c) === dc);
  if (!m) { sfx.bad(); return; }
  if (!tutorial.allowMove(m)) { toast(tutorial.blockMsg(), true); return; }
  doAction({ k: 'm', r: m.r, c: m.c });
}

// Mover o muro escolhido com as setas
function nudgeWall(dr, dc) {
  if (scene.view === 1) { dr = -dr; dc = -dc; }
  const p = app.pending;
  if (!p) { choosePending({ k: 'w', r: 3, c: 3, o: app.orient }); return; }
  choosePending(wallAt(p.r + dr, p.c + dc, p.o));
}

// ---------- Ações ----------
function doAction(a, fromNet = false) {
  if (!isLegal(app.state, a)) {
    if (!fromNet) {
      sfx.bad();
      toast(a.k === 'w' ? checkWall(app.state, app.state.turn, a).reason || 'Muro inválido' : 'Movimento inválido', true);
    }
    return false;
  }
  const prev = app.state;
  app.state = applyAction(prev, a);
  scene.sync(app.state, true);
  a.k === 'm' ? sfx.move() : sfx.wall();
  app.pending = null;
  if (a.k === 'w') app.tool = 'move';
  if (app.mode === 'online' && !fromNet) online.sendAct(a, prev.history.length);
  refresh();
  if (app.state.winner >= 0) onWin();
  else if (app.mode === 'local') setTimeout(() => scene.setView(app.state.turn), 500);
  else if (app.mode === 'bot') bot.play();
  tutorial.afterAction(a, prev.turn);
  return true;
}

function onWin() {
  const w = app.state.winner;
  setTimeout(() => scene.celebrate(w), 450);
  if (app.mode === 'tutorial') return;
  const vsSomeone = app.mode === 'online' || app.mode === 'bot';
  const iWon = vsSomeone && app.seats.includes(w);
  (vsSomeone && !iWon) ? sfx.lose() : sfx.win();
  setTimeout(() => {
    if (app.mode === 'menu') return;
    if (vsSomeone) {
      $('endTitle').textContent = iWon ? 'Você venceu! 🎉' : (app.mode === 'bot' ? 'O Robô venceu!' : app.names[w] + ' venceu!');
      $('endSub').textContent = iWon ? 'Mandou bem!' : 'Na próxima você consegue!';
    } else {
      $('endTitle').textContent = app.names[w] + ' venceu! 🎉';
      $('endSub').textContent = '';
    }
    $('btnRematch').disabled = false;
    $('btnRematch').textContent = '🔁 Jogar de novo';
    showScreen('endScreen');
  }, 1800);
}

// ---------- Entrada (mouse / toque) ----------
const isTouch = matchMedia('(pointer: coarse)').matches;
const canvas = scene.renderer.domElement;
let down = null;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  const pick = scene.pick(e.clientX, e.clientY);
  app.lastPick = pick;
  let pointer = false;
  if (canAct()) {
    const obj = scene.pickObject(e.clientX, e.clientY);
    if (obj && (obj.stock === app.state.turn || obj.pawn === app.state.turn)) pointer = true;
    if (app.tool === 'move') {
      const m = pick && nearestMove(pick);
      scene.setHover(m);
      if (m) pointer = true;
    } else {
      updateGhost(pick);
      if (pick && pick.inBoard) pointer = true;
    }
  }
  canvas.style.cursor = pointer ? 'pointer' : 'default';
});
canvas.addEventListener('pointerup', e => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8;
  const button = down.b;
  down = null;
  if (moved) return;
  if (button === 2) { if (app.tool === 'wall') rotate(); return; }
  if (button !== 0 || !canAct()) return;
  // Clicou na própria pilha de muros ou no próprio boneco: troca de ferramenta
  const obj = scene.pickObject(e.clientX, e.clientY);
  if (obj && obj.stock === app.state.turn) { setTool('wall'); return; }
  if (obj && obj.pawn === app.state.turn && app.tool === 'wall') { setTool('move'); return; }
  const pick = scene.pick(e.clientX, e.clientY);
  if (!pick) return;
  app.lastPick = pick;
  if (app.tool === 'move') {
    const m = nearestMove(pick);
    if (!m) { if (tutorial.active()) toast(tutorial.blockMsg()); return; }
    doAction({ k: 'm', r: m.r, c: m.c });
  } else {
    if (!pick.inBoard) return;
    const w = wallAt(pick.anchor.r, pick.anchor.c, app.orient);
    choosePending(w);
    const chk = wallCheck(w);
    if (!chk.ok) { sfx.bad(); toast(chk.reason, true); }
    else beep([440], 0.05, 'sine', 0.08);
  }
});
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key;
  if (k === 'r' || k === 'R') { if (app.tool === 'wall' && canAct()) rotate(); }
  if (k === '1') setTool('move');
  if (k === '2') setTool('wall');
  if (!canAct()) return;
  const dirs = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], w: [-1, 0], s: [1, 0], a: [0, -1], d: [0, 1] };
  const d = dirs[k] || dirs[k.toLowerCase()];
  if (d) {
    e.preventDefault();
    if (app.tool === 'move') moveByKey(d[0], d[1]); else nudgeWall(d[0], d[1]);
  }
  if (app.tool === 'wall' && k === 'Enter') { e.preventDefault(); confirmWall(); }
  if (app.tool === 'wall' && k === 'Escape') cancelWall();
});

$('btnConfirmWall').onclick = () => confirmWall();
$('btnCancelWall').onclick = () => cancelWall();
$('toolMove').onclick = () => setTool('move');
$('toolWall').onclick = () => setTool('wall');
$('btnRotate').onclick = () => rotate();
$('btnCam').onclick = () => scene.setView(scene.view);
$('btnSound').onclick = () => { soundOn = !soundOn; $('btnSound').textContent = soundOn ? '🔊' : '🔇'; };
$('btnExit').onclick = () => {
  if (app.mode === 'online' && app.state.winner < 0 && !confirm('Sair da partida online?')) return;
  goMenu();
};

// ---------- Robô simples (usado no tutorial) ----------
function botMove(s, p) {
  const exit = pawnMoves(s, p).find(m => m.kind === 'exit');
  if (exit) return { k: 'm', r: exit.r, c: exit.c };
  const ws = wallSet(s.walls);
  let best = null, bestD = 1e9;
  for (const m of pawnMoves(s, p, ws)) {
    const d = pathLength(ws, m, goalRow(p));
    if (d >= 0 && d < bestD) { bestD = d; best = m; }
  }
  return best && { k: 'm', r: best.r, c: best.c };
}

// ---------- Tutorial ----------
const TUT_STEPS = [
  {
    text: 'Bem-vindo ao <b>Barreira 3D</b>! Você é o bonequinho <b>AZUL</b>. Seu objetivo é atravessar o tabuleiro e <b>passar da barreira azul</b>: a faixa quadriculada lá do outro lado.',
    setup: () => newState(0),
  },
  {
    text: 'O adversário <span class="r"><b>VERMELHO</b></span> quer passar da barreira vermelha, do seu lado. <b>Quem passar primeiro vence!</b> Você pode girar a câmera arrastando com o botão direito (ou dois dedos).',
  },
  {
    text: 'Na sua vez você faz <b>UMA</b> coisa: <b>ANDAR uma casa</b> (frente, trás ou lados) <b>ou COLOCAR UM MURO</b>. Vamos andar: clique em uma <b>casa amarela</b> (no computador também dá para usar as <b>setas</b> do teclado).',
    wait: 'm',
  },
  {
    text: 'Os <b>muros</b> atrapalham o caminho do adversário. Cada jogador tem <b>10 muros</b> e cada muro cobre <b>2 casas</b>. Toque em <b>🧱 Muro</b> (ou na <b>pilha de muros</b> ao lado do tabuleiro), escolha um lugar <b>entre as casas</b> e toque em <b>✔ Colocar muro</b>. Use <b>↻ Girar</b> para deixá-lo em pé ou deitado.',
    wait: 'w',
  },
  {
    text: '<b>PULO:</b> quando o adversário está colado na sua frente, você pode <b>pular por cima dele</b>! Clique na <b>casa verde</b>.',
    setup: () => { const s = newState(0); s.pawns = [{ r: 5, c: 4 }, { r: 4, c: 4 }]; return s; },
    wait: 'm', only: 'jump',
  },
  {
    text: 'Se houver um <b>muro (ou a borda)</b> atrás do adversário, não dá pra pular reto: o pulo é na <b>DIAGONAL</b>. Clique em uma <b>casa verde</b>.',
    setup: () => { const s = newState(0); s.pawns = [{ r: 5, c: 4 }, { r: 4, c: 4 }]; s.walls = [{ r: 3, c: 4, o: 'h', p: 1 }]; s.wallsLeft = [10, 9]; return s; },
    wait: 'm', only: 'diag',
  },
  {
    text: '<b>CHEGADA:</b> chegar na última linha ainda não basta! Você precisa dar <b>mais um passo</b> para <b>passar a barreira</b> e pisar na faixa quadriculada. Cuidado: na beira da chegada dá para colocar <b>pedras</b> (um muro deitado) para tapar a saída do adversário! Clique na <b>casa verde</b> fora do tabuleiro.',
    setup: () => { const s = newState(0); s.pawns = [{ r: 0, c: 4 }, { r: 5, c: 2 }]; return s; },
    wait: 'm', only: 'exit',
  },
  {
    text: '<b>REGRA DE OURO:</b> é <b>proibido fechar totalmente</b> o caminho de alguém. Sempre tem que sobrar uma passagem! Veja: esse muro <span class="r"><b>vermelho</b></span> prenderia o adversário, então o jogo não deixa colocar.',
    setup: () => { const s = newState(0); s.pawns = [{ r: 6, c: 4 }, { r: 3, c: 0 }]; s.walls = [{ r: 2, c: 0, o: 'h', p: 0 }, { r: 3, c: 0, o: 'v', p: 0 }]; s.wallsLeft = [8, 10]; return s; },
    demo: { r: 4, c: 0, o: 'h' },
  },
  {
    text: 'Pronto! 🎉 Dica: pense no <b>caminho mais curto</b> até a barreira e guarde muros para a hora certa. Agora é só chamar um amigo e jogar online!',
    last: true,
  },
];

const tutorial = {
  i: -1, locked: false, done: false,
  active() { return app.mode === 'tutorial'; },
  step() { return TUT_STEPS[this.i]; },
  start() {
    app.mode = 'tutorial';
    app.seats = [0];
    app.names = ['Você', 'Robô'];
    showScreen(null);
    show('tutorial');
    scene.setView(0);
    this.go(0);
  },
  go(i) {
    this.i = i;
    const st = this.step();
    this.done = false;
    this.locked = !st.wait;
    if (st.setup) { app.state = st.setup(); scene.sync(app.state, false); }
    app.state.turn = 0;
    app.tool = 'move';
    $('tutStep').textContent = `Passo ${i + 1} de ${TUT_STEPS.length}`;
    $('tutText').innerHTML = st.text;
    $('tutNext').textContent = st.last ? 'Jogar! ▶' : 'Próximo ▶';
    $('tutNext').disabled = !!st.wait;
    scene.showGhost(st.demo || null, false);
    refresh();
    if (st.demo) scene.showGhost(st.demo, false);
  },
  next() {
    if (this.i >= TUT_STEPS.length - 1) return this.finish();
    this.go(this.i + 1);
  },
  finish() {
    try { localStorage.setItem('b3d_tutorial', '1'); } catch {}
    show('tutorial', false);
    goMenu();
  },
  allowMove(m) {
    if (!this.active()) return true;
    const st = this.step();
    if (st.wait !== 'm') return false;
    return !st.only || m.kind === st.only;
  },
  allowWall() {
    if (!this.active()) return true;
    return this.step().wait === 'w';
  },
  blockMsg() {
    const st = this.step();
    if (st.only === 'jump') return 'Tente o pulo: clique na casa verde!';
    if (st.only === 'diag') return 'Tente o pulo na diagonal: casa verde!';
    if (st.only === 'exit') return 'Passe a barreira: casa verde fora do tabuleiro!';
    if (st.wait === 'w') return 'Agora coloque um muro 🧱';
    return 'Siga a instrução do tutorial';
  },
  afterAction(a, who) {
    if (!this.active() || who !== 0) return;
    const st = this.step();
    if (st.wait !== a.k) return;
    this.locked = true;
    refresh();
    $('tutText').innerHTML = '<b>Muito bem!</b> 👏 Agora é a vez do Robô…';
    // Robô responde
    setTimeout(() => {
      if (!this.active()) return;
      if (app.state.winner < 0 && app.state.turn === 1) {
        const bm = botMove(app.state, 1);
        if (bm) doAction(bm, true);
      }
      setTimeout(() => { if (this.active()) this.next(); }, 900);
    }, 800);
  },
};
$('tutNext').onclick = () => tutorial.next();
$('tutSkip').onclick = () => tutorial.finish();
$('btnTutorial').onclick = () => tutorial.start();

// ---------- Jogo local ----------
let localStarter = 0;
function startLocal() {
  app.mode = 'local';
  app.seats = [0, 1];
  app.names = ['Azul', 'Vermelho'];
  app.state = newState(localStarter);
  app.tool = 'move';
  scene.sync(app.state, false);
  scene.setView(app.state.turn);
  showScreen(null);
  setNet('');
  refresh();
  toast(app.names[app.state.turn] + ' começa!');
}
$('btnLocal').onclick = startLocal;

// ---------- Contra o robô ----------
const LEVEL_NAMES = { facil: 'Fácil', medio: 'Médio', dificil: 'Difícil', impossivel: 'IMPOSSÍVEL' };
const bot = {
  level: 'medio', starter: 0, token: 0,
  start(level) {
    this.level = level;
    this.token++;
    app.mode = 'bot';
    app.seats = [0];
    app.names = [($('playerName').value.trim() || 'Você').slice(0, 14), 'Robô (' + LEVEL_NAMES[level] + ')'];
    app.state = newState(this.starter);
    app.tool = 'move';
    scene.sync(app.state, false);
    scene.setView(0);
    showScreen(null);
    setNet('');
    refresh();
    toast(this.starter === 0 ? 'Você começa!' : 'O Robô começa!');
    this.play();
  },
  worker: null, reqId: 0,
  think(state, level) {
    // Pensa em segundo plano (Web Worker); se não der, pensa aqui mesmo
    return new Promise(resolve => {
      try {
        if (!this.worker) {
          this.worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
          this.worker.onmessage = e => { const cb = this.pending[e.data.id]; delete this.pending[e.data.id]; cb && cb(e.data.action); };
          this.pending = {};
        }
        const id = ++this.reqId;
        this.pending[id] = resolve;
        this.worker.postMessage({ id, state, me: 1, level });
      } catch {
        resolve(chooseAction(state, 1, level));
      }
    });
  },
  async play() {
    if (app.mode !== 'bot' || app.state.winner >= 0 || app.state.turn !== 1) return;
    const token = this.token, n = app.state.history.length;
    const t0 = performance.now();
    const a = await this.think(app.state, this.level);
    const wait = Math.max(0, 650 + Math.random() * 400 - (performance.now() - t0));
    setTimeout(() => {
      if (app.mode !== 'bot' || token !== this.token || app.state.history.length !== n) return;
      if (a && !doAction(a, true)) {
        const b = chooseAction(app.state, 1, 'medio');
        if (b) doAction(b, true);
      }
    }, wait);
  },
};
$('btnBot').onclick = () => { saveName(); showScreen('botMenu'); };
$('btnBotBack').onclick = () => showScreen('menu');
for (const b of document.querySelectorAll('button.level')) b.onclick = () => { bot.starter = 0; bot.start(b.dataset.level); };

// ---------- Online ----------
const online = {
  net: null, role: null, code: '', peer: null, joined: false,
  g: 0, myReq: false, peerReq: false, lastSeen: 0, timers: [],

  myName() { return ($('playerName').value.trim() || 'Jogador').slice(0, 14); },

  begin(role, code) {
    this.stop();
    this.role = role; this.code = code;
    this.peer = null; this.joined = false; this.g = 0;
    this.myReq = this.peerReq = false;
    app.mode = 'online';
    app.seats = [role === 'host' ? 0 : 1];
    app.state = newState(0);
    scene.sync(app.state, false);
    scene.setView(app.seats[0], true);
    $('roomCode').textContent = code;
    $('lobbyTitle').textContent = role === 'host' ? 'Sala criada!' : 'Entrando na sala…';
    $('lobbyStatus').textContent = 'Conectando ao servidor…';
    $('btnCopy').classList.toggle('hidden', role !== 'host');
    showScreen('lobby');
    try { history.replaceState(null, '', '?sala=' + code); } catch {}

    this.net = new Net(code, m => this.onMsg(m), (st, n) => this.onStatus(st, n));
    this.net.connect();
    const started = Date.now();
    this.timers.push(setInterval(() => {
      if (!this.net) return;
      if (this.role === 'guest' && !this.joined) {
        this.net.send({ t: 'join', name: this.myName() });
        if (Date.now() - started > 30000) {
          toast('Sala não encontrada. Confira o código.', true);
          goMenu();
        }
      }
      if (this.peer) {
        this.net.send({ t: 'ping', g: this.g, n: app.state.history.length });
        const gone = Date.now() - this.lastSeen > 10000;
        setNet(gone ? '⚠️ Oponente desconectado…' : '🟢 Online');
      }
    }, 2000));
  },

  onStatus(st, n) {
    if (st === 'error') { toast('Falha na conexão: ' + n, true); return; }
    if (!this.peer) {
      if (n > 0) $('lobbyStatus').textContent = this.role === 'host' ? 'Aguardando seu amigo entrar…' : 'Procurando a sala…';
      else $('lobbyStatus').textContent = 'Conectando ao servidor…';
    } else if (n === 0) setNet('🔴 Reconectando…');
  },

  onMsg(m) {
    if (m.t === 'join' && this.role === 'host') {
      if (this.peer && this.peer !== m.from) { this.net.send({ t: 'full', to: m.from }); return; }
      const first = !this.peer;
      this.peer = m.from; this.lastSeen = Date.now();
      app.names = [this.myName(), (m.name || 'Jogador').slice(0, 14)];
      this.net.send({ t: 'welcome', to: m.from, name: this.myName(), g: this.g, starter: app.state.starter, history: app.state.history });
      if (first) this.enterGame();
      return;
    }
    if (m.t === 'welcome' && this.role === 'guest') {
      if (this.joined) return;
      this.joined = true; this.peer = m.from; this.lastSeen = Date.now();
      app.names = [(m.name || 'Jogador').slice(0, 14), this.myName()];
      this.g = m.g;
      app.state = replay(m.history || [], m.starter || 0);
      scene.sync(app.state, false);
      this.enterGame();
      return;
    }
    if (m.t === 'full' && this.role === 'guest' && !this.joined) {
      toast('Essa sala já está cheia.', true);
      goMenu();
      return;
    }
    if (m.from !== this.peer) return;
    this.lastSeen = Date.now();
    switch (m.t) {
      case 'act':
        if (m.g !== this.g) { if (m.g > this.g) this.net.send({ t: 'syncreq' }); return; }
        if (m.n === app.state.history.length) {
          if (app.seats.includes(app.state.turn)) return;
          if (!doAction(m.a, true)) this.net.send({ t: 'syncreq' });
        } else if (m.n > app.state.history.length) this.net.send({ t: 'syncreq' });
        break;
      case 'ping':
        if (m.g > this.g || (m.g === this.g && m.n > app.state.history.length)) this.net.send({ t: 'syncreq' });
        break;
      case 'syncreq':
        this.net.send({ t: 'sync', g: this.g, starter: app.state.starter, history: app.state.history });
        break;
      case 'sync':
        if (m.g > this.g || (m.g === this.g && m.history.length > app.state.history.length)) {
          const newGame = m.g > this.g;
          this.g = m.g;
          app.state = replay(m.history, m.starter);
          if (newGame) { this.myReq = this.peerReq = false; showScreen(null); }
          scene.sync(app.state, !newGame);
          refresh();
          if (app.state.winner >= 0) onWin();
        }
        break;
      case 'rematch':
        if (m.g !== this.g) break;
        if (!this.myReq) toast(app.names[1 - app.seats[0]] + ' quer jogar de novo!');
        this.peerReq = true;
        this.tryRematch();
        break;
      case 'bye':
        toast(app.names[1 - app.seats[0]] + ' saiu da partida.', true);
        setNet('🔴 Oponente saiu');
        this.lastSeen = 0;
        break;
    }
  },

  enterGame() {
    sfx.join();
    showScreen(null);
    setNet('🟢 Online');
    refresh();
    toast('Partida começou! ' + (app.seats.includes(app.state.turn) ? 'Você começa.' : app.names[app.state.turn] + ' começa.'));
  },

  sendAct(a, n) { this.net && this.net.send({ t: 'act', g: this.g, n, a }); },

  requestRematch() {
    this.myReq = true;
    this.net.send({ t: 'rematch', g: this.g });
    $('btnRematch').disabled = true;
    $('btnRematch').textContent = 'Aguardando oponente…';
    this.tryRematch();
  },

  tryRematch() {
    if (!(this.myReq && this.peerReq) || app.state.winner < 0) return;
    this.g++;
    this.myReq = this.peerReq = false;
    app.state = newState(this.g % 2);
    scene.sync(app.state, false);
    showScreen(null);
    app.tool = 'move';
    refresh();
    toast('Nova partida! ' + (app.seats.includes(app.state.turn) ? 'Você começa.' : app.names[app.state.turn] + ' começa.'));
  },

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.net) {
      if (this.peer) this.net.send({ t: 'bye' });
      const n = this.net;
      setTimeout(() => n.close(), 300);
      this.net = null;
    }
    this.peer = null;
  },
};

function setNet(txt) { $('netStatus').textContent = txt; }

$('btnCreate').onclick = () => { saveName(); online.begin('host', randomRoomCode()); };
$('btnJoin').onclick = () => {
  const code = $('roomInput').value.trim().toUpperCase();
  if (code.length !== 5) { toast('Digite o código de 5 letras da sala.', true); return; }
  saveName();
  online.begin('guest', code);
};
$('roomInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });
$('btnCopy').onclick = async () => {
  const link = location.origin + location.pathname + '?sala=' + online.code;
  try { await navigator.clipboard.writeText(link); toast('Link copiado! Mande para seu amigo.'); }
  catch { prompt('Copie o link:', link); }
};
$('btnLobbyBack').onclick = () => goMenu();

$('btnRematch').onclick = () => {
  if (app.mode === 'online') online.requestRematch();
  else if (app.mode === 'bot') { bot.starter = 1 - bot.starter; bot.start(bot.level); }
  else { localStarter = 1 - localStarter; startLocal(); }
};
$('btnEndMenu').onclick = () => goMenu();

function saveName() { try { localStorage.setItem('b3d_name', $('playerName').value.trim()); } catch {} }

function goMenu() {
  online.stop();
  bot.token++;
  app.mode = 'menu';
  app.seats = [];
  show('tutorial', false);
  tutorial.i = -1;
  tutorial.locked = false;
  app.state = newState(0);
  scene.sync(app.state, false);
  scene.showGhost(null);
  scene.showMoves([]);
  setNet('');
  try { history.replaceState(null, '', location.pathname); } catch {}
  showScreen('menu');
}

// ---------- Início ----------
try { $('playerName').value = localStorage.getItem('b3d_name') || ''; } catch {}
const params = new URLSearchParams(location.search);
const salaParam = (params.get('sala') || '').toUpperCase();
let seenTutorial = false;
try { seenTutorial = localStorage.getItem('b3d_tutorial') === '1'; } catch {}

scene.sync(app.state, false);
if (salaParam.length === 5) {
  $('roomInput').value = salaParam;
  showScreen('menu');
  toast('Você foi convidado! Digite seu nome e toque em Entrar.');
  $('playerName').focus();
} else if (!seenTutorial) {
  tutorial.start();
} else {
  showScreen('menu');
}
refresh();

// Acesso para depuração no console
window.b3d = { app, tutorial, online, bot, scene, doAction };
