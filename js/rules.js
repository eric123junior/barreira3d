// Regras do jogo (tabuleiro 9x9, 2 jogadores, 10 muros cada).
// Casas: (r, c) com r = linha 0..8 (0 = lado de cima), c = coluna 0..8.
// Muros: âncora (r, c) 0..7 = cruzamento entre as casas (r,c) e (r+1,c+1).
//   'h' (horizontal) bloqueia a passagem entre as linhas r e r+1 nas colunas c e c+1.
//   'v' (vertical)   bloqueia a passagem entre as colunas c e c+1 nas linhas r e r+1.

export const N = 9;
export const WALLS_PER_PLAYER = 10;
export const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function newState(starter = 0) {
  return {
    pawns: [{ r: 8, c: 4 }, { r: 0, c: 4 }],
    walls: [],
    wallsLeft: [WALLS_PER_PLAYER, WALLS_PER_PLAYER],
    turn: starter,
    starter,
    winner: -1,
    history: [],
  };
}

export function cloneState(s) {
  return {
    pawns: s.pawns.map(p => ({ ...p })),
    walls: s.walls.map(w => ({ ...w })),
    wallsLeft: [...s.wallsLeft],
    turn: s.turn,
    starter: s.starter,
    winner: s.winner,
    history: s.history.map(a => ({ ...a })),
  };
}

export const goalRow = p => (p === 0 ? 0 : N - 1);
// Para vencer é preciso passar da barreira: da última linha, dar mais um passo para fora do tabuleiro.
export const exitRow = p => (p === 0 ? -1 : N);
const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const key = (o, r, c) => o + r + ',' + c;

export function wallSet(walls) {
  const s = new Set();
  for (const w of walls) s.add(key(w.o, w.r, w.c));
  return s;
}

// Existe muro impedindo ir de (r,c) para (r+dr, c+dc)?
export function isBlocked(ws, r, c, dr, dc) {
  if (dr === 1) return ws.has(key('h', r, c)) || ws.has(key('h', r, c - 1));
  if (dr === -1) return ws.has(key('h', r - 1, c)) || ws.has(key('h', r - 1, c - 1));
  if (dc === 1) return ws.has(key('v', r, c)) || ws.has(key('v', r - 1, c));
  if (dc === -1) return ws.has(key('v', r, c - 1)) || ws.has(key('v', r - 1, c - 1));
  return false;
}

// Casas para onde o peão do jogador p pode ir (inclui pulos e diagonais).
export function pawnMoves(s, p, ws = wallSet(s.walls)) {
  const me = s.pawns[p], op = s.pawns[1 - p];
  const out = [];
  if (me.r === goalRow(p)) out.push({ r: exitRow(p), c: me.c, kind: 'exit' });
  for (const [dr, dc] of DIRS) {
    const r = me.r + dr, c = me.c + dc;
    if (!inside(r, c) || isBlocked(ws, me.r, me.c, dr, dc)) continue;
    if (op.r === r && op.c === c) {
      // Oponente colado: tenta pular reto
      const jr = r + dr, jc = c + dc;
      if (inside(jr, jc) && !isBlocked(ws, r, c, dr, dc)) {
        out.push({ r: jr, c: jc, kind: 'jump' });
      } else {
        // Muro ou borda atrás dele: pulo na diagonal
        for (const [pr, pc] of dr !== 0 ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]]) {
          const dr2 = r + pr, dc2 = c + pc;
          if (inside(dr2, dc2) && !isBlocked(ws, r, c, pr, pc)) out.push({ r: dr2, c: dc2, kind: 'diag' });
        }
      }
    } else {
      out.push({ r, c, kind: 'step' });
    }
  }
  return out;
}

// Menor distância (em passos, ignorando peões) até a linha de chegada; -1 se não houver caminho.
export function pathLength(ws, from, target) {
  const seen = new Uint8Array(N * N);
  let q = [[from.r, from.c]], d = 0;
  seen[from.r * N + from.c] = 1;
  while (q.length) {
    const nq = [];
    for (const [r, c] of q) {
      if (r === target) return d;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (!inside(nr, nc) || seen[nr * N + nc] || isBlocked(ws, r, c, dr, dc)) continue;
        seen[nr * N + nc] = 1;
        nq.push([nr, nc]);
      }
    }
    q = nq; d++;
  }
  return -1;
}

// Verifica se um muro pode ser colocado. Retorna { ok, reason }.
export function checkWall(s, p, w) {
  if (s.wallsLeft[p] <= 0) return { ok: false, reason: 'Você não tem mais muros.' };
  if (w.r < 0 || w.r > N - 2 || w.c < 0 || w.c > N - 2) return { ok: false, reason: 'Fora do tabuleiro.' };
  const ws = wallSet(s.walls);
  if (ws.has(key('h', w.r, w.c)) || ws.has(key('v', w.r, w.c))) return { ok: false, reason: 'Já existe um muro aqui.' };
  if (w.o === 'h' && (ws.has(key('h', w.r, w.c - 1)) || ws.has(key('h', w.r, w.c + 1))))
    return { ok: false, reason: 'Os muros não podem se sobrepor.' };
  if (w.o === 'v' && (ws.has(key('v', w.r - 1, w.c)) || ws.has(key('v', w.r + 1, w.c))))
    return { ok: false, reason: 'Os muros não podem se sobrepor.' };
  ws.add(key(w.o, w.r, w.c));
  for (let i = 0; i < 2; i++) {
    if (pathLength(ws, s.pawns[i], goalRow(i)) < 0)
      return { ok: false, reason: 'Proibido fechar todo o caminho de um jogador!' };
  }
  return { ok: true };
}

// Ação: { k: 'm', r, c } (mover) ou { k: 'w', r, c, o } (muro).
export function isLegal(s, a) {
  if (s.winner >= 0) return false;
  const p = s.turn;
  if (a.k === 'm') return pawnMoves(s, p).some(m => m.r === a.r && m.c === a.c);
  if (a.k === 'w') return (a.o === 'h' || a.o === 'v') && checkWall(s, p, a).ok;
  return false;
}

// Aplica a ação (já validada) e devolve um novo estado.
export function applyAction(s, a) {
  const n = cloneState(s);
  const p = n.turn;
  if (a.k === 'm') {
    n.pawns[p] = { r: a.r, c: a.c };
    if (a.r === exitRow(p)) n.winner = p;
  } else {
    n.walls.push({ r: a.r, c: a.c, o: a.o, p });
    n.wallsLeft[p]--;
  }
  n.history.push({ ...a });
  if (n.winner < 0) n.turn = 1 - p;
  return n;
}

// Reconstrói um estado a partir do histórico de ações.
export function replay(history, starter) {
  let s = newState(starter);
  for (const a of history) {
    if (!isLegal(s, a)) break;
    s = applyAction(s, a);
  }
  return s;
}
