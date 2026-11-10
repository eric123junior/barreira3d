// Robô adversário: escolhe entre andar e colocar muros avaliando os caminhos mais curtos.
import { N, DIRS, wallSet, isBlocked, pawnMoves, checkWall, applyAction, goalRow, exitRow, pathLength } from './rules.js';
import { searchBest } from './engine.js';

// Caminho mais curto (lista de casas) até a linha de chegada, ignorando peões.
function shortestPath(ws, from, target) {
  const prev = new Int16Array(N * N).fill(-1);
  const seen = new Uint8Array(N * N);
  const start = from.r * N + from.c;
  seen[start] = 1;
  let q = [start];
  while (q.length) {
    const nq = [];
    for (const id of q) {
      const r = Math.floor(id / N), c = id % N;
      if (r === target) {
        const path = [];
        for (let x = id; x !== -1; x = prev[x]) path.push({ r: Math.floor(x / N), c: x % N });
        return path.reverse();
      }
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        const nid = nr * N + nc;
        if (seen[nid] || isBlocked(ws, r, c, dr, dc)) continue;
        seen[nid] = 1; prev[nid] = id; nq.push(nid);
      }
    }
    q = nq;
  }
  return null;
}

// Muros que cortam os primeiros passos do caminho do jogador "victim".
function candidateWalls(s, victim, maxSteps = 6) {
  const ws = wallSet(s.walls);
  const path = shortestPath(ws, s.pawns[victim], goalRow(victim));
  const out = new Map();
  const add = (o, r, c) => {
    if (r < 0 || r > N - 2 || c < 0 || c > N - 2) return;
    out.set(o + r + ',' + c, { k: 'w', o, r, c });
  };
  if (path) {
    for (let i = 0; i < Math.min(maxSteps, path.length - 1); i++) {
      const a = path[i], b = path[i + 1];
      if (a.r !== b.r) {
        const r = Math.min(a.r, b.r);
        add('h', r, a.c); add('h', r, a.c - 1);
      } else {
        const c = Math.min(a.c, b.c);
        add('v', a.r, c); add('v', a.r - 1, c);
      }
    }
  }
  // Muros logo à frente do peão
  const p = s.pawns[victim];
  for (let dr = -1; dr <= 0; dr++) for (let dc = -1; dc <= 0; dc++) {
    add('h', p.r + dr, p.c + dc); add('v', p.r + dr, p.c + dc);
  }
  return [...out.values()].filter(w => checkWall(s, s.turn, w).ok);
}

function actions(s, p, wallsToo) {
  const list = pawnMoves(s, p).map(m => ({ k: 'm', r: m.r, c: m.c }));
  if (wallsToo && s.wallsLeft[p] > 0) list.push(...candidateWalls(s, 1 - p));
  return list;
}

// Pontuação do estado do ponto de vista de "me" (maior = melhor).
function evaluate(s, me) {
  if (s.winner === me) return 1000;
  if (s.winner === 1 - me) return -1000;
  const ws = wallSet(s.walls);
  const myD = pathLength(ws, s.pawns[me], goalRow(me));
  const opD = pathLength(ws, s.pawns[1 - me], goalRow(1 - me));
  // Quem joga a seguir ganha meio passo de vantagem
  const tempo = s.turn === me ? 0.5 : -0.5;
  return (opD - myD) + tempo + 0.35 * (s.wallsLeft[me] - s.wallsLeft[1 - me]);
}

const pickRandom = arr => arr[Math.floor(Math.random() * arr.length)];

function bestBy(list, score) {
  let best = -Infinity, bests = [];
  for (const a of list) {
    const v = score(a);
    if (v > best + 1e-9) { best = v; bests = [a]; }
    else if (Math.abs(v - best) < 1e-9) bests.push(a);
  }
  // Em empate prefere andar
  const moves = bests.filter(a => a.k === 'm');
  return pickRandom(moves.length ? moves : bests);
}

export function chooseAction(s, me, level = 'medio') {
  // Já está na última linha: passa a barreira e vence
  if (s.pawns[me].r === goalRow(me)) return { k: 'm', r: exitRow(me), c: s.pawns[me].c };
  // Níveis fortes usam o motor de busca
  if (level === 'impossivel') return searchBest(s, me, 3000, 10);
  if (level === 'dificil') return searchBest(s, me, 1000, 4);

  const ws = wallSet(s.walls);
  const moves = actions(s, me, false);
  const stepScore = a => {
    const n = applyAction(s, a);
    if (n.winner === me) return 1000;
    return -pathLength(ws, a, goalRow(me));
  };

  if (level === 'facil') {
    // Anda quase sempre pelo caminho mais curto; às vezes erra ou coloca um muro qualquer.
    const r = Math.random();
    if (r < 0.2 && s.wallsLeft[me] > 0) {
      const walls = candidateWalls(s, 1 - me);
      if (walls.length) return pickRandom(walls);
    }
    if (r > 0.85 && moves.length) return pickRandom(moves);
    return bestBy(moves, stepScore);
  }

  const all = actions(s, me, true);
  for (const a of moves) if (applyAction(s, a).winner === me) return a;

  // Médio: na maioria das vezes pensa como o difícil, mas às vezes joga sem prever a resposta
  if (level === 'medio' && Math.random() < 0.25) {
    return bestBy(all, a => evaluate(applyAction(s, a), me) + Math.random() * 0.3);
  }

  // Médio: olha a melhor resposta do adversário (2 jogadas)
  const opp = 1 - me;
  return bestBy(all, a => {
    const n = applyAction(s, a);
    if (n.winner === me) return 1000;
    let worst = Infinity;
    for (const b of actions(n, opp, true)) {
      const v = evaluate(applyAction(n, b), me);
      if (v < worst) worst = v;
      if (worst <= -1000) break;
    }
    return worst;
  });
}
