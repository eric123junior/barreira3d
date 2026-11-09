import { newState, applyAction, isLegal, pawnMoves, checkWall, replay, pathLength, wallSet, goalRow, WALLS_PER_PLAYER } from './rules.js';
import { GameScene } from './scene.js';
import { Net, randomRoomCode } from './net.js';

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
  mode: 'menu',        // menu | tutorial | local | online
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
  for (const s of ['menu', 'lobby', 'endScreen']) show(s, s === id);
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
  else turnTxt = app.seats.includes(s.turn) ? 'Sua vez!' : 'Vez do oponente';
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
  if (!mine || app.tool !== 'wall') { scene.showGhost(null); app.pending = null; }
  else if (app.lastPick) updateGhost(app.lastPick);

  let hint = '';
  if (mine && app.tool === 'move') hint = 'Clique numa casa brilhante para andar';
  if (mine && app.tool === 'wall') hint = isTouch ? 'Toque para ver o muro, toque de novo para colocar' : 'Clique para colocar • R ou botão direito para girar';
  if (!mine && app.mode === 'online' && s.winner < 0) hint = 'Aguardando a jogada do oponente…';
  $('hint').textContent = hint;
}

function setTool(t) {
  if (!canAct()) return;
  app.tool = t;
  app.pending = null;
  refresh();
}
function rotate() {
  app.orient = app.orient === 'h' ? 'v' : 'h';
  app.pending = null;
  refresh();
}

function updateGhost(pick) {
  if (tutorial.active() && tutorial.step()?.demo) return;
  if (!pick || !canAct() || app.tool !== 'wall' || !pick.inBoard) { scene.showGhost(null); return; }
  const w = { k: 'w', r: pick.anchor.r, c: pick.anchor.c, o: app.orient };
  scene.showGhost(w, checkWall(app.state, app.state.turn, w).ok && tutorial.allowWall(w));
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
  tutorial.afterAction(a, prev.turn);
  return true;
}

function onWin() {
  const w = app.state.winner;
  setTimeout(() => scene.celebrate(w), 450);
  if (app.mode === 'tutorial') return;
  const iWon = app.seats.includes(w) && app.mode === 'online';
  (app.mode === 'online' && !iWon) ? sfx.lose() : sfx.win();
  setTimeout(() => {
    if (app.mode === 'menu') return;
    if (app.mode === 'online') {
      $('endTitle').textContent = iWon ? 'Você venceu! 🎉' : app.names[w] + ' venceu!';
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
  app.lastPick = scene.pick(e.clientX, e.clientY);
  updateGhost(app.lastPick);
  canvas.style.cursor = canAct() ? 'pointer' : 'default';
});
canvas.addEventListener('pointerup', e => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8;
  const button = down.b;
  down = null;
  if (moved) return;
  if (button === 2) { if (app.tool === 'wall') rotate(); return; }
  if (button !== 0 || !canAct()) return;
  const pick = scene.pick(e.clientX, e.clientY);
  if (!pick) return;
  app.lastPick = pick;
  if (app.tool === 'move') {
    // Casa válida mais próxima do clique (tolerante a cliques em cima dos bonecos)
    let m = null, best = 0.75;
    for (const x of pawnMoves(app.state, app.state.turn)) {
      const d = Math.hypot(x.r - pick.fr, x.c - pick.fc);
      if (d < best) { best = d; m = x; }
    }
    if (!m) return;
    if (!tutorial.allowMove(m)) { toast(tutorial.blockMsg(), true); return; }
    doAction({ k: 'm', r: m.r, c: m.c });
  } else {
    if (!pick.inBoard) return;
    const w = { k: 'w', r: pick.anchor.r, c: pick.anchor.c, o: app.orient };
    if (e.pointerType === 'touch') {
      const p = app.pending;
      if (!p || p.r !== w.r || p.c !== w.c || p.o !== w.o) {
        app.pending = w;
        updateGhost(pick);
        const chk = checkWall(app.state, app.state.turn, w);
        if (!chk.ok) toast(chk.reason, true);
        return;
      }
    }
    if (!tutorial.allowWall(w)) { toast(tutorial.blockMsg(), true); return; }
    doAction(w);
  }
});
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'r' || e.key === 'R') { if (app.tool === 'wall' && canAct()) rotate(); }
  if (e.key === '1') setTool('move');
  if (e.key === '2') setTool('wall');
});

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
    text: 'Bem-vindo ao <b>Barreira 3D</b>! Você é o bonequinho <b>AZUL</b>. Seu objetivo é chegar em <b>qualquer casa da linha azul</b>, lá do outro lado do tabuleiro.',
    setup: () => newState(0),
  },
  {
    text: 'O adversário <span class="r"><b>VERMELHO</b></span> quer chegar na linha vermelha, do seu lado. <b>Quem chegar primeiro vence!</b> Você pode girar a câmera arrastando com o botão direito (ou dois dedos).',
  },
  {
    text: 'Na sua vez você faz <b>UMA</b> coisa: <b>ANDAR uma casa</b> (frente, trás ou lados) <b>ou COLOCAR UM MURO</b>. Vamos andar: clique em uma <b>casa amarela</b>.',
    wait: 'm',
  },
  {
    text: 'Os <b>muros</b> atrapalham o caminho do adversário. Cada jogador tem <b>10 muros</b> e cada muro cobre <b>2 casas</b>. Toque em <b>🧱 Muro</b>, escolha um lugar <b>entre as casas</b> e clique. Use <b>↻ Girar</b> para deixá-lo em pé ou deitado.',
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
    text: '<b>REGRA DE OURO:</b> é <b>proibido fechar totalmente</b> o caminho de alguém. Sempre tem que sobrar uma passagem! Veja: esse muro <span class="r"><b>vermelho</b></span> prenderia o adversário, então o jogo não deixa colocar.',
    setup: () => { const s = newState(0); s.pawns = [{ r: 6, c: 4 }, { r: 3, c: 0 }]; s.walls = [{ r: 2, c: 0, o: 'h', p: 0 }, { r: 3, c: 0, o: 'v', p: 0 }]; s.wallsLeft = [8, 10]; return s; },
    demo: { r: 4, c: 0, o: 'h' },
  },
  {
    text: 'Pronto! 🎉 Dica: pense no <b>caminho mais curto</b> até a sua linha e guarde muros para a hora certa. Agora é só chamar um amigo e jogar online!',
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
  else { localStarter = 1 - localStarter; startLocal(); }
};
$('btnEndMenu').onclick = () => goMenu();

function saveName() { try { localStorage.setItem('b3d_name', $('playerName').value.trim()); } catch {} }

function goMenu() {
  online.stop();
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
window.b3d = { app, tutorial, online, scene, doAction };
