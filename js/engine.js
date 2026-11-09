// Motor de busca forte (usado nos níveis Difícil e Impossível).
// Negamax com poda alfa-beta, aprofundamento iterativo e tabela de transposição.
// Usa vetores de bloqueio (em vez de strings) para calcular caminhos muito rápido.

const N = 9, NN = 81, M = 8;
const WIN = 100000;
const INF = 1e9;
const ABORT = Symbol('abort');

export const params = { wallW: 8, reserve: 6, tempo: 5, l1: 16, ln: 8, levels: 5, tt: true, sat: 3, satW: 4, repPen: 14, progress: 2, stats: false };

const goalRow = p => (p === 0 ? 0 : N - 1);
const STEP = [-N, N, -1, 1];

// Números aleatórios fixos para o "hash" da posição
const ZW = new Int32Array(128), ZP = new Int32Array(2 * NN), ZT = 0x5bd1e995;
{
  let x = 2463534242;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x | 0; };
  for (let i = 0; i < 128; i++) ZW[i] = rnd();
  for (let i = 0; i < 2 * NN; i++) ZP[i] = rnd();
}

class Board {
  constructor(state, me) {
    // down[i]: bloqueado entre (r,c) e (r+1,c); right[i]: bloqueado entre (r,c) e (r,c+1)
    this.down = new Uint8Array(NN);
    this.right = new Uint8Array(NN);
    this.hA = new Uint8Array(M * M);
    this.vA = new Uint8Array(M * M);
    this.pos = [state.pawns[0].r * N + state.pawns[0].c, state.pawns[1].r * N + state.pawns[1].c];
    this.wl = [...state.wallsLeft];
    this.turn = me;
    this.hash = 0;
    this.queue = new Int16Array(NN);
    this.dist = new Int16Array(NN);
    for (const w of state.walls) this.setWall(w.o, w.r, w.c, 1);
  }

  setWall(o, r, c, v) {
    const i = r * N + c, s = v ? 1 : -1;
    if (o === 'h') { this.down[i] += s; this.down[i + 1] += s; this.hA[r * M + c] = v; }
    else { this.right[i] += s; this.right[i + N] += s; this.vA[r * M + c] = v; }
    this.hash ^= ZW[(o === 'h' ? 0 : 64) + r * M + c];
  }

  wallFits(o, r, c) {
    if (r < 0 || r >= M || c < 0 || c >= M) return false;
    const a = r * M + c;
    if (this.hA[a] || this.vA[a]) return false;
    if (o === 'h') return !(c > 0 && this.hA[a - 1]) && !(c < M - 1 && this.hA[a + 1]);
    return !(r > 0 && this.vA[a - M]) && !(r < M - 1 && this.vA[a + M]);
  }

  // Dá para sair da casa i na direção d (0 cima, 1 baixo, 2 esquerda, 3 direita)?
  open(i, d) {
    const c = i % N;
    switch (d) {
      case 0: return i >= N && !this.down[i - N];
      case 1: return i < NN - N && !this.down[i];
      case 2: return c > 0 && !this.right[i - 1];
      default: return c < N - 1 && !this.right[i];
    }
  }

  // Menor distância de "from" até a linha de chegada do jogador p (-1 se não houver)
  distFrom(from, p) {
    const goal = goalRow(p);
    const d = this.dist, q = this.queue;
    d.fill(-1);
    let h = 0, t = 0;
    d[from] = 0; q[t++] = from;
    while (h < t) {
      const i = q[h++];
      if (((i / N) | 0) === goal) return d[i];
      const nd = d[i] + 1;
      if (i >= N && !this.down[i - N] && d[i - N] < 0) { d[i - N] = nd; q[t++] = i - N; }
      if (i < NN - N && !this.down[i] && d[i + N] < 0) { d[i + N] = nd; q[t++] = i + N; }
      const c = i % N;
      if (c > 0 && !this.right[i - 1] && d[i - 1] < 0) { d[i - 1] = nd; q[t++] = i - 1; }
      if (c < N - 1 && !this.right[i] && d[i + 1] < 0) { d[i + 1] = nd; q[t++] = i + 1; }
    }
    return -1;
  }

  // Mapa de distâncias até a chegada de p (BFS a partir da linha)
  goalMap(p) {
    const d = new Int16Array(NN).fill(-1), q = this.queue;
    const goal = goalRow(p);
    let h = 0, t = 0;
    for (let c = 0; c < N; c++) { d[goal * N + c] = 0; q[t++] = goal * N + c; }
    while (h < t) {
      const i = q[h++];
      const nd = d[i] + 1;
      for (let dir = 0; dir < 4; dir++) {
        if (!this.open(i, dir)) continue;
        const j = i + STEP[dir];
        if (d[j] < 0) { d[j] = nd; q[t++] = j; }
      }
    }
    return d;
  }

  pawnMoves(p) {
    const me = this.pos[p], op = this.pos[1 - p];
    const out = [];
    for (let dir = 0; dir < 4; dir++) {
      if (!this.open(me, dir)) continue;
      const j = me + STEP[dir];
      if (j !== op) { out.push(j); continue; }
      if (this.open(j, dir)) { out.push(j + STEP[dir]); continue; }
      for (const side of dir < 2 ? [2, 3] : [0, 1]) if (this.open(j, side)) out.push(j + STEP[side]);
    }
    return out;
  }
}

class Search {
  constructor(state, me, deadline) {
    this.b = new Board(state, me);
    this.deadline = deadline;
    this.nodes = 0;
    this.tt = new Map();
    // Casas por onde este peão passou recentemente
    this.visited = new Map();
    if (state.history) {
      const pos = [{ r: 8, c: 4 }, { r: 0, c: 4 }];
      let turn = state.starter ?? 0;
      const mine = [];
      for (const a of state.history) {
        if (a.k === 'm') { pos[turn] = { r: a.r, c: a.c }; if (turn === me) mine.push(a.r * N + a.c); }
        turn = 1 - turn;
      }
      for (const i of mine.slice(-6)) this.visited.set(i, (this.visited.get(i) || 0) + 1);
    }
  }

  key() {
    const b = this.b;
    return ((b.hash ^ ZP[b.pos[0]] ^ ZP[NN + b.pos[1]] ^ (b.turn ? ZT : 0)) * 121) + b.wl[0] * 11 + b.wl[1];
  }

  evaluate() {
    const b = this.b, p = b.turn, q = 1 - p;
    const dp = b.distFrom(b.pos[p], p), dq = b.distFrom(b.pos[q], q);
    const wp = b.wl[p], wq = b.wl[q];
    // Corridas já decididas
    if (wq === 0 && dp <= dq) return 5000 + 10 * (dq - dp) + wp;
    if (wp === 0 && dq < dp) return -5000 - 10 * (dp - dq) - wq;
    // Valor dos muros + bônus por guardar alguns de reserva
    const wv = params.wallW * (wp - wq) + params.reserve * (Math.min(wp, 2) - Math.min(wq, 2));
    // Vantagem grande demais vale menos: evita gastar muros à toa quando já está bem na frente
    const x = dq - dp, S = params.sat;
    const lead = x > S ? 10 * S + params.satW * (x - S) : x < -S ? -10 * S + params.satW * (x + S) : 10 * x;
    return lead + wv + params.tempo;
  }

  // Muros que cortam os caminhos mais curtos do adversário, com o ganho de cada um
  wallCandidates(p, limit, levels, extras) {
    const b = this.b, q = 1 - p;
    const dQ = b.goalMap(q);
    const cand = new Map();
    const add = (o, r, c) => {
      if (!b.wallFits(o, r, c)) return;
      cand.set((o === 'h' ? 0 : 64) + r * M + c, { k: 'w', o, r, c, gain: 0 });
    };
    let frontier = [b.pos[q]];
    const seen = new Set(frontier);
    for (let lv = 0; lv < levels && frontier.length; lv++) {
      const next = [];
      for (const i of frontier) {
        const r = (i / N) | 0, c = i % N;
        for (let dir = 0; dir < 4; dir++) {
          if (!b.open(i, dir)) continue;
          const j = i + STEP[dir];
          if (dQ[j] !== dQ[i] - 1) continue;
          if (dir === 0) { add('h', r - 1, c); add('h', r - 1, c - 1); }
          else if (dir === 1) { add('h', r, c); add('h', r, c - 1); }
          else if (dir === 2) { add('v', r, c - 1); add('v', r - 1, c - 1); }
          else { add('v', r, c); add('v', r - 1, c); }
          if (!seen.has(j)) { seen.add(j); next.push(j); }
        }
      }
      frontier = next;
    }
    if (extras) {
      for (const pi of b.pos) {
        const pr = (pi / N) | 0, pc = pi % N;
        for (let dr = -2; dr <= 1; dr++) for (let dc = -2; dc <= 1; dc++) { add('h', pr + dr, pc + dc); add('v', pr + dr, pc + dc); }
      }
    }
    const dp0 = b.distFrom(b.pos[p], p), dq0 = dQ[b.pos[q]];
    const out = [];
    for (const w of cand.values()) {
      b.setWall(w.o, w.r, w.c, 1);
      const dq = b.distFrom(b.pos[q], q);
      const dp = dq < 0 ? -1 : b.distFrom(b.pos[p], p);
      b.setWall(w.o, w.r, w.c, 0);
      if (dq < 0 || dp < 0) continue;
      w.gain = (dq - dq0) - (dp - dp0);
      if (w.gain > 0 || (extras && w.gain === 0)) out.push(w);
    }
    out.sort((x, y) => y.gain - x.gain);
    return out.slice(0, limit);
  }

  actions(ply) {
    const b = this.b, p = b.turn;
    const dP = b.goalMap(p);
    const here = dP[b.pos[p]];
    const list = b.pawnMoves(p).map(j => ({ k: 'm', to: j, gain: here - dP[j] }));
    if (b.wl[p] > 0) {
      const walls = ply === 0 ? this.wallCandidates(p, 60, 99, true)
        : ply === 1 ? this.wallCandidates(p, params.l1, 99, false)
        : this.wallCandidates(p, params.ln, params.levels, false);
      for (const w of walls) list.push(w);
    }
    list.sort((x, y) => (y.gain - (y.k === 'w' ? 0.6 : 0)) - (x.gain - (x.k === 'w' ? 0.6 : 0)));
    return list;
  }

  make(a) {
    const b = this.b, p = b.turn;
    if (a.k === 'm') { a.from = b.pos[p]; b.pos[p] = a.to; }
    else { b.setWall(a.o, a.r, a.c, 1); b.wl[p]--; }
    b.turn = 1 - p;
  }

  unmake(a) {
    const b = this.b, p = 1 - b.turn;
    if (a.k === 'm') b.pos[p] = a.from;
    else { b.setWall(a.o, a.r, a.c, 0); b.wl[p]++; }
    b.turn = p;
  }

  rootPenalty(a) {
    if (a.k !== 'm') return 0;
    return params.repPen * (this.visited.get(a.to) || 0) - params.progress * a.gain;
  }

  same(a, x) { return a.k === x.k && (a.k === 'm' ? a.to === x.to : a.o === x.o && a.r === x.r && a.c === x.c); }

  negamax(depth, alpha, beta, ply, rootOrder) {
    if ((++this.nodes & 255) === 0 && performance.now() > this.deadline) throw ABORT;
    if (depth === 0) return this.evaluate();
    const b = this.b;
    const alpha0 = alpha;
    const k = ply > 0 ? this.key() : 0;
    let ttMove = null;
    if (ply > 0 && params.tt) {
      const e = this.tt.get(k);
      if (e) {
        if (e.depth >= depth) {
          if (e.flag === 0) return e.value;
          if (e.flag === 1 && e.value >= beta) return e.value;
          if (e.flag === 2 && e.value <= alpha) return e.value;
        }
        ttMove = e.move;
      }
    }
    const p = b.turn;
    const acts = rootOrder || this.actions(ply);
    if (ttMove) {
      const i = acts.findIndex(a => this.same(a, ttMove));
      if (i > 0) acts.unshift(acts.splice(i, 1)[0]);
    }
    let best = -INF, bestA = null;
    for (const a of acts) {
      let v;
      // Na raiz: evita ficar indo e voltando e prefere avançar
      const pen = ply === 0 ? this.rootPenalty(a) : 0;
      if (a.k === 'm' && ((a.to / N) | 0) === goalRow(p)) v = WIN - ply;
      else {
        this.make(a);
        v = -this.negamax(depth - 1, -beta, -(alpha + pen), ply + 1, null) - pen;
        this.unmake(a);
      }
      if (ply === 0) a.score = v;
      if (v > best) { best = v; bestA = a; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    if (ply > 0) this.tt.set(k, { depth, value: best, move: bestA, flag: best <= alpha0 ? 2 : best >= beta ? 1 : 0 });
    else this.bestA = bestA;
    return best;
  }
}

function toAction(a) {
  if (!a) return null;
  return a.k === 'm' ? { k: 'm', r: (a.to / N) | 0, c: a.to % N } : { k: 'w', r: a.r, c: a.c, o: a.o };
}

// Escolhe a melhor ação para "me" pensando até timeMs milissegundos (ou até maxDepth jogadas).
export function searchBest(state, me, timeMs = 1500, maxDepth = 12) {
  const t0 = performance.now();
  const s = new Search(state, me, t0 + timeMs);
  let order = s.actions(0);
  let best = order[0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    let v;
    try {
      v = s.negamax(depth, -INF, INF, 0, order);
    } catch (e) {
      if (e === ABORT) break;
      throw e;
    }
    // Se tudo perde contra jogo perfeito, fica com a escolha da rodada anterior (resiste mais)
    if (v <= -(WIN - 100) && depth > 1) break;
    best = s.bestA;
    if (params.stats) { params.lastDepth = depth; params.nodes = s.nodes; }
    order = [...order].sort((a, b) => (b.score ?? -INF) - (a.score ?? -INF));
    for (const a of order) a.score = undefined;
    if (v >= WIN - 100) break;
    if (performance.now() - t0 > timeMs * 0.4) break; // a próxima profundidade não daria tempo
  }
  return toAction(best);
}

// Diagnóstico: valor de cada ação na raiz (janela completa)
export function analyze(state, me, depth) {
  const s = new Search(state, me, Infinity);
  return s.actions(0).map(a => {
    let v;
    if (a.k === 'm' && ((a.to / N) | 0) === goalRow(me)) v = WIN;
    else { s.make(a); v = -s.negamax(depth - 1, -INF, INF, 1, null); s.unmake(a); }
    return [JSON.stringify(toAction(a)), v];
  }).sort((x, y) => y[1] - x[1]);
}
