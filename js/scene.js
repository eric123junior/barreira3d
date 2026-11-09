// Cena 3D: tabuleiro, personagens, muros, destaques e seleção com o mouse/toque.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { N, WALLS_PER_PLAYER } from './rules.js';

const S = 1;            // distância entre centros das casas
const TILE = 0.8;       // tamanho da casa
const TILE_H = 0.18;
const TOP = TILE_H;     // altura do topo das casas
const WALL_LEN = 2 * S - (S - TILE) - 0.04;
const WALL_T = 0.13;
const WALL_H = 0.55;

export const COLORS = [0x2f7cf6, 0xf0503c];
export const COLORS_CSS = ['#2f7cf6', '#f0503c'];

const cellPos = (r, c) => new THREE.Vector3((c - 4) * S, TOP, (r - 4) * S);
const anchorPos = (r, c) => new THREE.Vector3((c - 3.5) * S, TOP, (r - 3.5) * S);

function woodTexture(base, line) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 22; i++) {
    g.strokeStyle = line; g.globalAlpha = 0.12 + Math.random() * 0.18;
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    const y = Math.random() * 64;
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 32) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeCharacter(color) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xffd9b3, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.3 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.2, 6, 16), mat);
  torso.position.y = 0.36; body.add(torso);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 24), dark);
  belt.rotation.x = Math.PI / 2; belt.position.y = 0.3; body.add(belt);

  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.08, 4, 10), dark);
    leg.position.set(sx * 0.08, 0.1, 0); body.add(leg);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), black);
    foot.scale.set(1, 0.6, 1.4); foot.position.set(sx * 0.08, 0.035, 0.03); body.add(foot);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 4, 10), mat);
    arm.position.set(sx * 0.22, 0.38, 0); arm.rotation.z = sx * 0.35; body.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), skin);
    hand.position.set(sx * 0.26, 0.27, 0); body.add(hand);
    arm.userData.side = sx;
  }

  const head = new THREE.Group();
  head.position.y = 0.68; body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), skin);
  head.add(skull);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), white);
    eye.position.set(sx * 0.065, 0.02, 0.145); eye.scale.z = 0.6; head.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), black);
    pupil.position.set(sx * 0.065, 0.02, 0.172); head.add(pupil);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xff9a9a, roughness: 0.8 }));
    cheek.position.set(sx * 0.11, -0.04, 0.12); cheek.scale.z = 0.4; head.add(cheek);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.009, 6, 16, Math.PI), black);
  smile.rotation.z = Math.PI; smile.position.set(0, -0.045, 0.158); head.add(smile);
  // boné
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.175, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  cap.position.y = 0.02; head.add(cap);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 20, 1, false, -Math.PI / 2, Math.PI), dark);
  brim.position.set(0, 0.03, 0.12); brim.scale.z = 1.1; head.add(brim);
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), white);
  pom.position.y = 0.2; head.add(pom);

  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = { body, head };
  return g;
}

function makeWallMesh(mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(WALL_LEN, WALL_H, WALL_T), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class GameScene {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fd3f5);
    scene.fog = new THREE.Fog(0x9fd3f5, 22, 48);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 22;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.minPolarAngle = Math.PI * 0.08;
    this.controls.target.set(0, 0, 0);
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };

    scene.add(new THREE.HemisphereLight(0xdff1ff, 0x5b4632, 1.1));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
    sun.position.set(6, 14, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    this.buildWorld();
    this.buildBoard();

    // Personagens
    this.pawns = COLORS.map(c => makeCharacter(c));
    this.pawnAnim = [null, null];
    for (const p of this.pawns) scene.add(p);

    // Muros
    this.wallMats = COLORS.map(c => {
      const m = new THREE.MeshStandardMaterial({ map: woodTexture('#f4e2c4', '#9a6a3c'), roughness: 0.55 });
      m.color = new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.2);
      return m;
    });
    this.placed = new Map();   // chave -> mesh
    this.stock = [[], []];     // muros de reserva ao lado do tabuleiro
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < WALLS_PER_PLAYER; i++) {
        const m = makeWallMesh(this.wallMats[p]);
        m.position.copy(this.stockPos(p, i));
        m.rotation.y = 0;
        scene.add(m);
        this.stock[p].push(m);
      }
    }
    this.wallAnims = [];

    // Fantasma do muro
    this.ghostMat = new THREE.MeshStandardMaterial({ color: 0x44dd66, transparent: true, opacity: 0.55, depthWrite: false });
    this.ghost = makeWallMesh(this.ghostMat);
    this.ghost.castShadow = false;
    this.ghost.visible = false;
    scene.add(this.ghost);

    // Destaques de movimento
    this.hlGroup = new THREE.Group();
    scene.add(this.hlGroup);
    this.hlGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.04, 28);
    this.hlMat = new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffc400, emissiveIntensity: 0.6, transparent: true, opacity: 0.85 });
    this.hlSpecial = new THREE.MeshStandardMaterial({ color: 0x9cff7a, emissive: 0x44ff00, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 });
    this.highlights = [];

    // Anel da vez
    this.turnRing = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 40),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 }));
    this.turnRing.rotation.x = Math.PI / 2;
    scene.add(this.turnRing);

    this.particles = [];
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP);
    this.clock = new THREE.Clock();
    this.view = 0;
    this.camAnim = null;
    this.resize();
    this.setView(0, true);

    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.tick());
  }

  buildWorld() {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48),
      new THREE.MeshStandardMaterial({ color: 0x7cc46b, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Mesa
    const tableMat = new THREE.MeshStandardMaterial({ map: woodTexture('#8a5a33', '#3d2210'), roughness: 0.7 });
    const table = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 9.5, 0.5, 64), tableMat);
    table.position.y = -0.55; table.receiveShadow = true;
    this.scene.add(table);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.6, 1, 24), tableMat);
    leg.position.y = -1.2; this.scene.add(leg);

    // Árvores e pedras em volta
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a4b25, roughness: 0.9 });
    const leafMats = [0x3f9e4d, 0x4fb35a, 0x2f8a46].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true }));
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.9, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
      const d = 15 + Math.random() * 12;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.random() < 0.75) {
        const t = new THREE.Group();
        const s = 0.8 + Math.random() * 0.9;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.6, 8), trunkMat);
        trunk.position.y = 0.8; t.add(trunk);
        for (let k = 0; k < 3; k++) {
          const leaf = new THREE.Mesh(new THREE.ConeGeometry(1.3 - k * 0.3, 1.5, 8), leafMats[(i + k) % 3]);
          leaf.position.y = 1.9 + k * 0.75; t.add(leaf);
        }
        t.scale.setScalar(s);
        t.position.set(x, -1.2, z);
        t.traverse(o => { if (o.isMesh) o.castShadow = true; });
        this.scene.add(t);
      } else {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + Math.random() * 0.8, 0), rockMat);
        rock.position.set(x, -1, z);
        this.scene.add(rock);
      }
    }
    // Nuvens
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    this.clouds = [];
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(1 + Math.random(), 12, 8), cloudMat);
        s.position.set(k * 1.3 - 2, Math.random() * 0.6, Math.random() * 0.8);
        c.add(s);
      }
      const a = Math.random() * Math.PI * 2;
      c.position.set(Math.cos(a) * 30, 12 + Math.random() * 6, Math.sin(a) * 30);
      c.userData.speed = 0.2 + Math.random() * 0.3;
      this.scene.add(c);
      this.clouds.push(c);
    }
  }

  buildBoard() {
    const base = new THREE.Mesh(new THREE.BoxGeometry(N * S + 0.6, 0.35, N * S + 0.6),
      new THREE.MeshStandardMaterial({ map: woodTexture('#5b3519', '#2a160a'), roughness: 0.6 }));
    base.position.y = -0.175;
    base.receiveShadow = true; base.castShadow = true;
    this.scene.add(base);
    // Faixas coloridas atrás das linhas de chegada
    for (let p = 0; p < 2; p++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(N * S + 0.6, 0.36, 0.25),
        new THREE.MeshStandardMaterial({ color: COLORS[p], roughness: 0.5 }));
      strip.position.set(0, -0.17, p === 0 ? -(N * S + 0.6) / 2 - 0.12 : (N * S + 0.6) / 2 + 0.12);
      this.scene.add(strip);
    }

    const tileGeo = new THREE.BoxGeometry(TILE, TILE_H, TILE);
    this.tileMats = {
      a: new THREE.MeshStandardMaterial({ color: 0xf2e2c4, roughness: 0.7 }),
      b: new THREE.MeshStandardMaterial({ color: 0xe6d1ad, roughness: 0.7 }),
    };
    this.goalMats = COLORS.map(c => new THREE.MeshStandardMaterial({
      color: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.55), roughness: 0.6 }));
    this.tiles = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        let mat = (r + c) % 2 ? this.tileMats.a : this.tileMats.b;
        if (r === 0) mat = this.goalMats[0];      // chegada do jogador 0 (azul)
        if (r === N - 1) mat = this.goalMats[1];  // chegada do jogador 1 (vermelho)
        const t = new THREE.Mesh(tileGeo, mat);
        t.position.set((c - 4) * S, TILE_H / 2, (r - 4) * S);
        t.receiveShadow = true;
        t.userData = { r, c };
        this.scene.add(t);
        this.tiles.push(t);
      }
    }
  }

  stockPos(p, i) {
    const side = p === 0 ? 1 : -1;
    return new THREE.Vector3(side * (N * S / 2 + 1.25), -0.3 + WALL_H / 2, side * ((i - 4.5) * 0.42));
  }

  setView(p, instant = false) {
    this.view = p;
    const k = (this.camDist || 16) / 15.9;
    const side = p === 0 ? 1 : -1;
    const target = new THREE.Vector3(0, 11.5 * k, 11 * k * side);
    // Na tela em pé, olha um pouco além do centro para o tabuleiro descer e não ficar atrás dos painéis
    this.controls.target.set(0, 0, -side * (this.portrait ? 2 : 0));
    if (instant) {
      this.camera.position.copy(target);
      this.controls.update();
    } else {
      this.camAnim = { from: this.camera.position.clone(), to: target, t: 0 };
    }
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Em telas estreitas, afasta a câmera
    const aspect = w / h;
    const wasPortrait = this.portrait;
    this.portrait = aspect < 0.8;
    this.camera.fov = aspect < 0.8 ? 58 : 45;
    this.camera.updateProjectionMatrix();
    // Distância para o tabuleiro inteiro caber na largura da tela
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const prev = this.camDist;
    this.camDist = Math.max(16, 5.7 / (halfH * aspect));
    this.controls.maxDistance = Math.max(22, this.camDist + 4);
    if (prev && (Math.abs(prev - this.camDist) > 0.5 || wasPortrait !== this.portrait)) this.setView(this.view, true);
  }

  // Sincroniza a cena com o estado do jogo
  sync(state, animate = true) {
    for (let p = 0; p < 2; p++) {
      const pos = cellPos(state.pawns[p].r, state.pawns[p].c);
      const pawn = this.pawns[p];
      const cur = pawn.userData.cell;
      const changed = !cur || cur.r !== state.pawns[p].r || cur.c !== state.pawns[p].c;
      pawn.userData.cell = { ...state.pawns[p] };
      if (changed && animate && cur) {
        this.pawnAnim[p] = { from: pawn.position.clone(), to: pos, t: 0, dur: 0.45 };
        const dx = pos.x - pawn.position.x, dz = pos.z - pawn.position.z;
        pawn.userData.face = Math.atan2(dx, dz);
      } else if (changed || !animate) {
        this.pawnAnim[p] = null;
        pawn.position.copy(pos);
      }
      if (!animate || !cur) pawn.userData.face = p === 0 ? Math.PI : 0;
    }
    // Muros colocados
    const keys = new Set();
    for (const w of state.walls) {
      const k = w.o + w.r + ',' + w.c;
      keys.add(k);
      if (this.placed.has(k)) continue;
      const owner = w.p ?? 0;
      const mesh = this.stock[owner].find(m => !m.userData.used) || makeWallMesh(this.wallMats[owner]);
      if (!mesh.parent) this.scene.add(mesh);
      mesh.userData.used = true;
      mesh.userData.key = k;
      const to = anchorPos(w.r, w.c); to.y = TOP + WALL_H / 2;
      const rotTo = w.o === 'h' ? 0 : Math.PI / 2;
      this.placed.set(k, mesh);
      if (animate) {
        this.wallAnims.push({ mesh, from: mesh.position.clone(), to, rotFrom: mesh.rotation.y, rotTo, t: 0, dur: 0.6 });
      } else {
        mesh.position.copy(to); mesh.rotation.y = rotTo;
      }
    }
    for (const [k, mesh] of this.placed) {
      if (!keys.has(k)) {
        this.placed.delete(k);
        mesh.userData.used = false;
      }
    }
    // Recoloca reservas não usadas
    for (let p = 0; p < 2; p++) {
      let i = 0;
      for (const m of this.stock[p]) {
        if (m.userData.used) continue;
        this.wallAnims = this.wallAnims.filter(a => a.mesh !== m);
        m.position.copy(this.stockPos(p, i++));
        m.rotation.y = 0;
      }
    }
    this.turn = state.turn;
    this.winner = state.winner;
  }

  showMoves(moves, special) {
    for (const h of this.highlights) this.hlGroup.remove(h);
    this.highlights = [];
    for (const m of moves) {
      const isSp = special && special(m);
      const h = new THREE.Mesh(this.hlGeo, isSp ? this.hlSpecial : this.hlMat);
      h.position.copy(cellPos(m.r, m.c)); h.position.y += 0.03;
      h.userData = { r: m.r, c: m.c };
      this.hlGroup.add(h);
      this.highlights.push(h);
    }
  }

  showGhost(w, ok) {
    if (!w) { this.ghost.visible = false; return; }
    this.ghost.visible = true;
    const p = anchorPos(w.r, w.c);
    this.ghost.position.set(p.x, TOP + WALL_H / 2, p.z);
    this.ghost.rotation.y = w.o === 'h' ? 0 : Math.PI / 2;
    this.ghostMat.color.set(ok ? 0x44dd66 : 0xff3b3b);
  }

  // Converte a posição do ponteiro em casa e âncora de muro
  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return null;
    const fc = hit.x / S + 4, fr = hit.z / S + 4;
    const r = Math.round(fr), c = Math.round(fc);
    const inBoard = fr > -0.6 && fr < N - 0.4 && fc > -0.6 && fc < N - 0.4;
    const ar = Math.min(N - 2, Math.max(0, Math.round(fr - 0.5)));
    const ac = Math.min(N - 2, Math.max(0, Math.round(fc - 0.5)));
    // Orientação sugerida: perto de qual sulco o ponteiro está
    const dr = Math.abs(fr - (ar + 0.5)), dc = Math.abs(fc - (ac + 0.5));
    return { fr, fc, cell: inBoard ? { r, c } : null, anchor: { r: ar, c: ac }, nearH: dr < dc, inBoard };
  }

  burst(pos, color, count = 24) {
    const geo = new THREE.SphereGeometry(0.05, 6, 4);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 }));
      m.position.copy(pos);
      const a = Math.random() * Math.PI * 2;
      m.userData = { v: new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2), 2 + Math.random() * 3, Math.sin(a) * (1 + Math.random() * 2)), life: 1.2 };
      this.scene.add(m);
      this.particles.push(m);
    }
  }

  celebrate(p) {
    const pos = this.pawns[p].position.clone(); pos.y += 0.6;
    this.burst(pos, COLORS[p], 40);
    this.burst(pos, 0xffd700, 30);
  }

  tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    if (this.camAnim) {
      const a = this.camAnim;
      a.t = Math.min(1, a.t + dt / 1.2);
      this.camera.position.lerpVectors(a.from, a.to, easeInOut(a.t));
      if (a.t >= 1) this.camAnim = null;
    }
    this.controls.update();

    for (let p = 0; p < 2; p++) {
      const pawn = this.pawns[p];
      const { body, head } = pawn.userData;
      const anim = this.pawnAnim[p];
      if (anim) {
        anim.t = Math.min(1, anim.t + dt / anim.dur);
        const e = easeInOut(anim.t);
        pawn.position.lerpVectors(anim.from, anim.to, e);
        pawn.position.y = anim.from.y + Math.sin(Math.PI * anim.t) * 0.6;
        body.scale.set(1, 1 + Math.sin(Math.PI * anim.t) * 0.12, 1);
        if (anim.t >= 1) {
          this.pawnAnim[p] = null;
          this.burst(pawn.position.clone().setY(TOP + 0.05), 0xffffff, 8);
        }
      } else {
        const winning = this.winner === p;
        const bob = winning ? Math.abs(Math.sin(t * 6)) * 0.4 : Math.abs(Math.sin(t * 2.2 + p)) * 0.04;
        body.position.y = bob;
        body.scale.set(1, 1, 1);
        if (winning) pawn.userData.face = (pawn.userData.face || 0) + dt * 5;
      }
      // Virar na direção desejada
      const face = pawn.userData.face ?? 0;
      let d = face - pawn.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      pawn.rotation.y += d * Math.min(1, dt * 8);
      head.rotation.z = Math.sin(t * 1.5 + p * 2) * 0.06;
    }

    // Anel da vez
    if (this.winner >= 0 || this.turn === undefined) {
      this.turnRing.visible = false;
    } else {
      this.turnRing.visible = true;
      const pp = this.pawns[this.turn].position;
      this.turnRing.position.set(pp.x, TOP + 0.03, pp.z);
      this.turnRing.material.color.set(COLORS[this.turn]);
      this.turnRing.material.emissive.set(COLORS[this.turn]);
      this.turnRing.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
    }

    for (const h of this.highlights) h.position.y = TOP + 0.03 + Math.sin(t * 4) * 0.02;
    this.hlMat.opacity = 0.65 + Math.sin(t * 4) * 0.2;
    if (this.ghost.visible) this.ghostMat.opacity = 0.45 + Math.sin(t * 6) * 0.12;

    this.wallAnims = this.wallAnims.filter(a => {
      a.t = Math.min(1, a.t + dt / a.dur);
      const e = easeOut(a.t);
      a.mesh.position.lerpVectors(a.from, a.to, e);
      a.mesh.position.y = a.from.y + (a.to.y - a.from.y) * e + Math.sin(Math.PI * a.t) * 1.6;
      a.mesh.rotation.y = a.rotFrom + (a.rotTo - a.rotFrom) * e;
      if (a.t >= 1) {
        this.burst(a.to.clone().setY(TOP), 0xd9b48a, 14);
        return false;
      }
      return true;
    });

    this.particles = this.particles.filter(m => {
      m.userData.life -= dt;
      m.userData.v.y -= 9 * dt;
      m.position.addScaledVector(m.userData.v, dt);
      m.scale.setScalar(Math.max(0.01, m.userData.life));
      if (m.userData.life <= 0 || m.position.y < -0.3) {
        this.scene.remove(m); m.material.dispose();
        return false;
      }
      return true;
    });

    for (const c of this.clouds) {
      const a = Math.atan2(c.position.z, c.position.x) + dt * 0.01 * c.userData.speed;
      const d = Math.hypot(c.position.x, c.position.z);
      c.position.x = Math.cos(a) * d; c.position.z = Math.sin(a) * d;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
