import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const N = 5;
const SIZE = 1;
// wartości ścian w kolejności materiałów BoxGeometry: +x, -x, +y, -y, +z, -z
const FACE_VALUES = [1, 6, 2, 5, 3, 4];
const FACE_AXES = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];
const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
};

function faceTexture(value) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#d9d2c3';
  g.fillRect(0, 0, s, s);
  const grad = g.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s * 0.75);
  grad.addColorStop(0, '#fbf8f1');
  grad.addColorStop(1, '#e6dfcf');
  g.fillStyle = grad;
  const r = 34, m = 6;
  g.beginPath();
  g.roundRect(m, m, s - 2 * m, s - 2 * m, r);
  g.fill();
  for (const [x, y] of PIPS[value]) {
    const pg = g.createRadialGradient(x * s - 4, y * s - 4, 2, x * s, y * s, 24);
    pg.addColorStop(0, value === 1 ? '#e2333a' : '#3a3a44');
    pg.addColorStop(1, value === 1 ? '#8e0e15' : '#0c0c12');
    g.fillStyle = pg;
    g.beginPath();
    g.arc(x * s, y * s, value === 1 ? 30 : 22, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function feltTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#1f5e3f';
  g.fillRect(0, 0, s, s);
  const img = g.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Sound {
  constructor() { this.ctx = null; this.last = 0; }
  unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* brak dźwięku */ }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  click(strength) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - this.last < 0.035) return;
    this.last = now;
    const dur = 0.05;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800 + Math.random() * 1500;
    f.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(0.9, strength / 12);
    src.connect(f).connect(gain).connect(ctx.destination);
    src.start(now);
  }
}

export class DiceTray {
  constructor(container) {
    this.container = container;
    this.onTap = null;
    this.rolling = false;
    this.held = new Array(N).fill(false);
    this.heldQ = new Array(N).fill(null);   // orientacja „górą do góry” zatrzymanej kości
    this.heldVal = new Array(N).fill(0);    // wartość zatrzymanej kości (na półce kość jest pochylona do kamery)
    this.sound = new Sound();
    this.anims = [];

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#2a1a10');
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x203020, 1.3));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-4, 14, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -9; sc.right = 9; sc.top = 12; sc.bottom = -12; sc.near = 1; sc.far = 40;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    // fizyka
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -32, 0) });
    world.allowSleep = false;
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 12;
    this.world = world;
    this.matDie = new CANNON.Material('die');
    this.matFloor = new CANNON.Material('floor');
    this.matWall = new CANNON.Material('wall');
    world.addContactMaterial(new CANNON.ContactMaterial(this.matDie, this.matFloor, { friction: 0.35, restitution: 0.35 }));
    world.addContactMaterial(new CANNON.ContactMaterial(this.matDie, this.matWall, { friction: 0.1, restitution: 0.6 }));
    world.addContactMaterial(new CANNON.ContactMaterial(this.matDie, this.matDie, { friction: 0.2, restitution: 0.4 }));

    const floor = new CANNON.Body({ mass: 0, material: this.matFloor, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(floor);

    this.trayGroup = new THREE.Group();
    scene.add(this.trayGroup);
    this.wallBodies = [];

    // kości
    const mats = FACE_VALUES.map((v) => new THREE.MeshStandardMaterial({ map: faceTexture(v), roughness: 0.35, metalness: 0.0 }));
    const geo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
    this.dice = [];
    for (let i = 0; i < N; i++) {
      const mesh = new THREE.Mesh(geo, mats.map((m) => m.clone()));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.index = i;
      scene.add(mesh);
      const body = new CANNON.Body({
        mass: 1, material: this.matDie,
        shape: new CANNON.Box(new CANNON.Vec3(SIZE / 2, SIZE / 2, SIZE / 2)),
        linearDamping: 0.1, angularDamping: 0.1,
      });
      body.addEventListener('collide', (e) => {
        const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
        if (v > 1.5) this.sound.click(v);
      });
      world.addBody(body);
      this.dice.push({ mesh, body });
    }

    this.raycaster = new THREE.Raycaster();
    renderer.domElement.addEventListener('pointerdown', (e) => this._tap(e));

    this._resize();
    new ResizeObserver(() => this._resize()).observe(container);
    this._layoutInitial();

    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this._frame());
  }

  _resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    const aspect = w / h;
    this.camera.aspect = aspect;

    // obszar: stół (halfW x halfD) + półka na zatrzymane kości
    const halfW = 3.1;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanH = tanV * aspect;
    const shelf = 1.7;
    // wysokość kamery tak, by zmieściła się szerokość stołu z marginesem
    let height = (halfW + 0.8) / tanH;
    let visHalfD = height * tanV;
    // minimalna głębokość stołu
    const minHalfD = 3.4;
    if (visHalfD - shelf / 2 < minHalfD + 0.4) {
      height = (minHalfD + 0.4 + shelf / 2) / tanV;
      visHalfD = height * tanV;
    }
    const halfD = Math.max(minHalfD, visHalfD - shelf / 2 - 0.4);
    const trayHalfW = Math.max(halfW, height * tanH - 0.9);
    this.dims = { halfW: trayHalfW, halfD, shelfZ: halfD + shelf / 2 };
    // środek widoku przesunięty, żeby objąć półkę
    const cz = shelf / 2;
    this.camera.position.set(0, height, cz + 0.001);
    this.camera.lookAt(0, 0, cz);
    this.camera.updateProjectionMatrix();
    this._buildWalls();
    for (let i = 0; i < N; i++) if (this.held[i]) this._placeHeld(i, false);
  }

  _buildWalls() {
    const { halfW, halfD } = this.dims;
    for (const b of this.wallBodies) this.world.removeBody(b);
    this.wallBodies = [];
    this.trayGroup.clear();

    const felt = new THREE.Mesh(
      new THREE.PlaneGeometry(halfW * 2, halfD * 2),
      new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.95 }),
    );
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    this.trayGroup.add(felt);

    const shelf = new THREE.Mesh(
      new THREE.PlaneGeometry(halfW * 2 + 1, 2.4),
      new THREE.MeshStandardMaterial({ color: '#4a2e1c', roughness: 0.8 }),
    );
    shelf.rotation.x = -Math.PI / 2;
    shelf.position.set(0, 0.001, halfD + 1.2);
    shelf.receiveShadow = true;
    this.trayGroup.add(shelf);

    const wood = new THREE.MeshStandardMaterial({ color: '#7a4a28', roughness: 0.6 });
    const t = 0.35, wh = 1.0;
    const addWall = (cx, cz, sx, sz, physH = 12) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, wh, sz), wood);
      m.position.set(cx, wh / 2, cz);
      m.castShadow = true; m.receiveShadow = true;
      this.trayGroup.add(m);
      const b = new CANNON.Body({ mass: 0, material: this.matWall, shape: new CANNON.Box(new CANNON.Vec3(sx / 2, physH / 2, sz / 2)) });
      b.position.set(cx, physH / 2, cz);
      this.world.addBody(b);
      this.wallBodies.push(b);
    };
    addWall(-halfW - t / 2, 0, t, halfD * 2 + 2 * t);
    addWall(halfW + t / 2, 0, t, halfD * 2 + 2 * t);
    addWall(0, -halfD - t / 2, halfW * 2, t);
    addWall(0, halfD + t / 2, halfW * 2, t);
    // sufit, żeby kości nie wyleciały
    const ceil = new CANNON.Body({ mass: 0, material: this.matWall, shape: new CANNON.Plane() });
    ceil.quaternion.setFromEuler(Math.PI / 2, 0, 0);
    ceil.position.set(0, 12, 0);
    this.world.addBody(ceil);
    this.wallBodies.push(ceil);
  }

  _layoutInitial() {
    for (let i = 0; i < N; i++) {
      const { body } = this.dice[i];
      body.type = CANNON.Body.DYNAMIC;
      body.position.set(-2.4 + i * 1.2, SIZE / 2, 0);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        Math.floor(Math.random() * 4) * Math.PI / 2,
        Math.random() * 0.6 - 0.3,
        Math.floor(Math.random() * 4) * Math.PI / 2,
      ));
      body.quaternion.set(q.x, q.y, q.z, q.w);
      body.velocity.setZero();
      body.angularVelocity.setZero();
    }
    this._sync();
  }

  _sync() {
    for (const { mesh, body } of this.dice) {
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
    }
  }

  topAxis(i) {
    const q = this.dice[i].mesh.quaternion;
    let best = 0, bestY = -2;
    const v = new THREE.Vector3();
    for (let k = 0; k < 6; k++) {
      v.copy(FACE_AXES[k]).applyQuaternion(q);
      if (v.y > bestY) { bestY = v.y; best = k; }
    }
    return { k: best, y: bestY };
  }

  values() {
    return this.dice.map((_, i) => (this.held[i] && this.heldQ[i] ? this.heldVal[i] : FACE_VALUES[this.topAxis(i).k]));
  }

  _tap(e) {
    if (!this.onTap) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    const hits = this.raycaster.intersectObjects(this.dice.map((d) => d.mesh));
    let idx = hits.length ? hits[0].object.userData.index : -1;
    if (idx < 0) {
      // tolerancja dla palca: najbliższa kość w promieniu
      const pt = new THREE.Vector3();
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SIZE / 2);
      if (this.raycaster.ray.intersectPlane(plane, pt)) {
        let bd = 0.9;
        this.dice.forEach((d, i) => {
          const dist = Math.hypot(d.mesh.position.x - pt.x, d.mesh.position.z - pt.z);
          if (dist < bd) { bd = dist; idx = i; }
        });
      }
    }
    if (idx >= 0) this.onTap(idx);
  }

  _slot(i) {
    const n = N;
    const gap = Math.min(1.35, (this.dims.halfW * 2 - 0.4) / n);
    return new THREE.Vector3((i - (n - 1) / 2) * gap, SIZE / 2, this.dims.shelfZ + 0.35);
  }

  _animate(i, toPos, toQuat, ms, then) {
    const { mesh } = this.dice[i];
    this.anims = this.anims.filter((a) => a.i !== i);
    this.anims.push({
      i, t0: performance.now(), ms,
      fromP: mesh.position.clone(), toP: toPos.clone(),
      fromQ: mesh.quaternion.clone(), toQ: toQuat.clone(), then,
    });
  }

  _placeHeld(i, animate = true) {
    const { mesh, body } = this.dice[i];
    if (!this.heldQ[i]) {
      // obróć tak, by górna ściana była idealnie na górze
      const { k } = this.topAxis(i);
      const axisW = FACE_AXES[k].clone().applyQuaternion(mesh.quaternion);
      const fix = new THREE.Quaternion().setFromUnitVectors(axisW, new THREE.Vector3(0, 1, 0));
      let q0 = fix.multiply(mesh.quaternion.clone());
      // wyrównaj obrót wokół osi pionowej do wielokrotności 90°
      const side = FACE_AXES[(k + 2) % 6].clone().applyQuaternion(q0);
      const yaw = Math.atan2(side.z, side.x);
      const err = yaw - Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
      q0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), err).multiply(q0);
      this.heldQ[i] = q0;
      this.heldVal[i] = FACE_VALUES[k];
    }
    const pos = this._slot(i);
    // na półce pochyl kość wynikiem do kamery, żeby było widać tę samą ścianę, którą liczy gra
    const toCam = this.camera.position.clone().sub(pos).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), toCam).multiply(this.heldQ[i]);

    body.type = CANNON.Body.STATIC;
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.collisionResponse = false;
    const done = () => {
      body.position.set(pos.x, pos.y, pos.z);
      body.quaternion.set(q.x, q.y, q.z, q.w);
    };
    if (animate) this._animate(i, pos, q, 260, done);
    else { mesh.position.copy(pos); mesh.quaternion.copy(q); done(); }
    this._highlight(i, true);
  }

  _unplaceHeld(i) {
    const { mesh, body } = this.dice[i];
    // wróć na stół w wolne miejsce
    const spot = this._freeSpot(i);
    const q = this.heldQ[i] ? this.heldQ[i].clone() : mesh.quaternion.clone();
    this.heldQ[i] = null;
    const done = () => {
      body.type = CANNON.Body.DYNAMIC;
      body.collisionResponse = true;
      body.position.set(spot.x, spot.y, spot.z);
      body.quaternion.set(q.x, q.y, q.z, q.w);
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.wakeUp();
    };
    this._animate(i, spot, q, 260, done);
    this._highlight(i, false);
  }

  _freeSpot(self) {
    const { halfW, halfD } = this.dims;
    for (let tries = 0; tries < 60; tries++) {
      const x = (Math.random() * 2 - 1) * (halfW - 0.8);
      const z = (Math.random() * 2 - 1) * (halfD - 0.8);
      const ok = this.dice.every((d, j) => j === self || this.held[j] ||
        Math.hypot(d.body.position.x - x, d.body.position.z - z) > 1.3);
      if (ok) return new THREE.Vector3(x, SIZE / 2 + 0.02, z);
    }
    return new THREE.Vector3(0, 2.5, 0);
  }

  _highlight(i, on) {
    for (const m of this.dice[i].mesh.material) {
      m.emissive = new THREE.Color(on ? '#ffb000' : '#000000');
      m.emissiveIntensity = on ? 0.45 : 0;
    }
  }

  setHeld(i, on) {
    if (this.rolling || this.held[i] === on) return;
    this.held[i] = on;
    if (on) this._placeHeld(i); else this._unplaceHeld(i);
  }

  // wszystkie kości wracają na stół (nowa tura)
  releaseAll() {
    for (let i = 0; i < N; i++) if (this.held[i]) { this.held[i] = false; this._unplaceHeld(i); }
  }

  // obróć kość tak, by na górze była podana wartość (gra sieciowa: wynik z drugiego telefonu)
  faceUp(i, value, ms = 0) {
    const { mesh, body } = this.dice[i];
    if (FACE_VALUES[this.topAxis(i).k] === value) return;
    const k = FACE_VALUES.indexOf(value);
    const axisW = FACE_AXES[k].clone().applyQuaternion(mesh.quaternion);
    const q = new THREE.Quaternion().setFromUnitVectors(axisW, new THREE.Vector3(0, 1, 0)).multiply(mesh.quaternion.clone());
    body.velocity.setZero();
    body.angularVelocity.setZero();
    const done = () => {
      body.quaternion.set(q.x, q.y, q.z, q.w);
      body.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
    };
    if (ms) this._animate(i, mesh.position.clone(), q, ms, done);
    else { mesh.quaternion.copy(q); done(); }
  }

  // ustaw wynik bez rzutu: wartości i zatrzymane kości (synchronizacja po ponownym połączeniu)
  setState(vals, held) {
    if (this._settle) { const s = this._settle; this._settle = null; s.resolve(this.values()); }
    this.rolling = false;
    this.anims = [];
    for (let i = 0; i < N; i++) {
      const { mesh, body } = this.dice[i];
      if (this.held[i]) {
        this.held[i] = false;
        if (this.heldQ[i]) { const h = this.heldQ[i]; body.quaternion.set(h.x, h.y, h.z, h.w); }
        this.heldQ[i] = null;
        this._highlight(i, false);
        const spot = this._freeSpot(i);
        body.type = CANNON.Body.DYNAMIC;
        body.collisionResponse = true;
        body.position.set(spot.x, SIZE / 2, spot.z);
        mesh.position.copy(body.position);
      }
      mesh.quaternion.copy(body.quaternion);
      // połóż płasko
      const { k } = this.topAxis(i);
      const axisW = FACE_AXES[k].clone().applyQuaternion(mesh.quaternion);
      const q = new THREE.Quaternion().setFromUnitVectors(axisW, new THREE.Vector3(0, 1, 0)).multiply(mesh.quaternion.clone());
      mesh.quaternion.copy(q);
      body.quaternion.set(q.x, q.y, q.z, q.w);
      body.velocity.setZero();
      body.angularVelocity.setZero();
      this.faceUp(i, vals[i]);
    }
    for (let i = 0; i < N; i++) if (held[i]) { this.held[i] = true; this._placeHeld(i, false); }
  }

  roll() {
    if (this.rolling) return Promise.resolve(this.values());
    this.sound.unlock();
    this.rolling = true;
    const { halfW, halfD } = this.dims;
    const side = Math.random() < 0.5 ? -1 : 1;
    let k = 0;
    for (let i = 0; i < N; i++) {
      if (this.held[i]) continue;
      const { body } = this.dice[i];
      this.anims = this.anims.filter((a) => a.i !== i);
      body.type = CANNON.Body.DYNAMIC;
      body.collisionResponse = true;
      body.position.set(side * (halfW - 1) + (Math.random() - 0.5), 2.5 + k * 1.1, -halfD + 1.2 + k * 0.9);
      const q = new CANNON.Quaternion();
      q.setFromEuler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      body.quaternion.copy(q);
      body.velocity.set(-side * (6 + Math.random() * 6), -2, 10 + Math.random() * 6);
      body.angularVelocity.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 40);
      body.wakeUp();
      k++;
    }
    return new Promise((resolve) => {
      this._settle = { t0: performance.now(), still: 0, resolve, nudges: 0 };
    });
  }

  _checkSettle() {
    const s = this._settle;
    if (!s) return;
    const moving = this.dice.some((d, i) => !this.held[i] &&
      (d.body.velocity.lengthSquared() > 0.01 || d.body.angularVelocity.lengthSquared() > 0.02));
    s.still = moving ? 0 : s.still + 1;
    const elapsed = performance.now() - s.t0;
    if (s.still > 18 || elapsed > 7000) {
      // kość oparta krzywo? lekko ją trąć
      // albo leży na innej kości (z góry nie widać wtedy wyniku tej pod spodem)
      const cocked = this.dice.findIndex((d, i) => !this.held[i] &&
        (this.topAxis(i).y < 0.97 || d.body.position.y > SIZE / 2 + 0.25));
      if (cocked >= 0 && s.nudges < 10 && elapsed < 11000) {
        s.nudges++;
        s.still = 0;
        const b = this.dice[cocked].body;
        const stacked = b.position.y > SIZE / 2 + 0.25;
        const ang = Math.random() * Math.PI * 2;
        const sp = stacked ? 4 : 1.5;
        b.velocity.set(Math.cos(ang) * sp, 4, Math.sin(ang) * sp);
        b.angularVelocity.set((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10);
        return;
      }
      // awaryjnie: kość wciąż leży na innej – przestaw ją na wolne miejsce na stole
      this.dice.forEach((d, i) => {
        if (this.held[i] || d.body.position.y <= SIZE / 2 + 0.25) return;
        const spot = this._freeSpot(i);
        d.body.position.set(spot.x, SIZE / 2, spot.z);
        d.body.velocity.setZero();
        d.body.angularVelocity.setZero();
      });
      this._settle = null;
      this.rolling = false;
      s.resolve(this.values());
    }
  }

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    if (this.rolling) {
      this.world.step(1 / 120, dt, 8);
    } else {
      this.world.step(1 / 60, dt, 2);
    }
    for (let i = 0; i < N; i++) {
      const { mesh, body } = this.dice[i];
      if (this.anims.some((a) => a.i === i)) continue;
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
    }
    const now = performance.now();
    this.anims = this.anims.filter((a) => {
      const t = Math.min(1, (now - a.t0) / a.ms);
      const e = 1 - Math.pow(1 - t, 3);
      const { mesh } = this.dice[a.i];
      mesh.position.lerpVectors(a.fromP, a.toP, e);
      mesh.position.y += Math.sin(Math.PI * t) * 0.8;
      mesh.quaternion.slerpQuaternions(a.fromQ, a.toQ, e);
      if (t >= 1) { a.then && a.then(); return false; }
      return true;
    });
    this._checkSettle();
    this.renderer.render(this.scene, this.camera);
  }
}
