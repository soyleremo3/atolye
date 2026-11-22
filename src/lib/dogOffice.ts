/**
 * Kopek ofisi: ajanlari 3B bir ofiste masalarinda oturan kopekler olarak cizer.
 * Her sey prosedureldir (dosya/model yok). Ekip = oda, ajan = masa + kopek.
 * Durum: uyuyor (yatar, Zz) · calisiyor (oturur, ekran yanar, kafa sallar) · bitti (kuyruk sallar, ✓)
 *        takildi (!) · hata (kirmizi ✗) · planli (yari saydam).
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type OfficeState = "idle" | "working" | "done" | "failed" | "blocked" | "planned";
export type OfficeAgent = {
  id: string;
  number: string;
  label: string;
  team: string;
  provider: "claude" | "google" | "none";
  state: OfficeState;
  lead?: boolean;
};
type Hit = { kind: "agent"; id: string } | { kind: "approvals" };
export type OfficeOptions = { dark: boolean; onSelect: (hit: Hit | null) => void };

const TEAM_ORDER = ["lead", "sales", "developer", "general"];
const TEAM_NAME: Record<string, string> = { lead: "Yönetim", developer: "Developer", sales: "Satış", general: "Genel" };
const TEAM_FLOOR: Record<string, [number, number]> = {
  lead: [0xf6d7d7, 0x3a2a2e],
  developer: [0xd6e6f7, 0x22303f],
  sales: [0xf7ecc8, 0x3a3524],
  general: [0xd8f0dc, 0x243a2a],
};
const DESK_W = 2.7;
const DESK_D = 2.9;

// ------------------------------------------------------------------ yardimcilar
function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...opts });
}

function box(w: number, h: number, d: number, m: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function ball(r: number, m: THREE.Material, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), m);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  return mesh;
}

/** Yuvarlak koseli etiket: canvas -> sprite. */
function textSprite(text: string, opts: { bg?: string; fg?: string; size?: number; bold?: boolean } = {}) {
  const size = opts.size ?? 34;
  const font = `${opts.bold ? "700" : "500"} ${size}px "Segoe UI", system-ui, sans-serif`;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + size;
  const h = Math.ceil(size * 1.6);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  if (opts.bg) {
    g.fillStyle = opts.bg;
    const r = h / 2;
    g.beginPath();
    g.moveTo(r, 0);
    g.arcTo(w, 0, w, h, r);
    g.arcTo(w, h, 0, h, r);
    g.arcTo(0, h, 0, 0, r);
    g.arcTo(0, 0, w, 0, r);
    g.fill();
  }
  g.font = font;
  g.fillStyle = opts.fg ?? "#1b1d23";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  const scale = 0.0125 * (size / 34);
  sprite.scale.set(w * scale, h * scale, 1);
  return sprite;
}

// ------------------------------------------------------------------ kopek
type Dog = {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  tail: THREE.Group;
  eyesOpen: THREE.Object3D[];
  eyesClosed: THREE.Object3D[];
  materials: THREE.MeshStandardMaterial[];
  phase: number;
};

const DOG_COLORS = {
  claude: { coat: 0xd9893a, light: 0xf4dcbc, dark: 0x8a4b1c },
  google: { coat: 0x7f93ad, light: 0xe8edf3, dark: 0x3d4b5e },
  none: { coat: 0xb9b2a6, light: 0xeeeae2, dark: 0x6d6658 },
};

function makeDog(provider: OfficeAgent["provider"], lead: boolean): Dog {
  const c = DOG_COLORS[provider];
  const coat = mat(c.coat);
  const light = mat(c.light);
  const dark = mat(c.dark);
  const black = mat(0x15161a, { roughness: 0.3 });
  const materials = [coat, light, dark, black];

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // govde + gogus
  body.add(ball(0.42, coat, 1, 0.82, 1.25).translateY(0.42));
  const chest = ball(0.3, light, 1, 1, 0.9);
  chest.position.set(0, 0.45, -0.3);
  body.add(chest);
  // bacaklar
  for (const [x, z] of [[-0.2, -0.32], [0.2, -0.32], [-0.22, 0.3], [0.22, 0.3]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.42, 10), coat);
    leg.position.set(x, 0.18, z);
    leg.castShadow = true;
    body.add(leg);
    const paw = ball(0.1, light, 1.1, 0.6, 1.3);
    paw.position.set(x, 0.0, z - 0.04);
    body.add(paw);
  }
  // kuyruk (pivot)
  const tail = new THREE.Group();
  tail.position.set(0, 0.55, 0.5);
  const tailMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.32, 4, 8), provider === "claude" ? light : coat);
  tailMesh.position.set(0, 0.16, 0.06);
  tailMesh.rotation.x = -0.6;
  tail.add(tailMesh);
  body.add(tail);

  // kafa (pivot boyunda)
  const head = new THREE.Group();
  head.position.set(0, 0.78, -0.42);
  head.add(ball(0.3, coat, 1, 0.95, 1));
  const snout = ball(0.16, light, 1, 0.8, 1.2);
  snout.position.set(0, -0.07, -0.25);
  head.add(snout);
  const nose = ball(0.055, black);
  nose.position.set(0, -0.02, -0.43);
  head.add(nose);
  const eyesOpen: THREE.Object3D[] = [];
  const eyesClosed: THREE.Object3D[] = [];
  for (const x of [-0.12, 0.12]) {
    const eye = ball(0.045, black);
    eye.position.set(x, 0.06, -0.25);
    head.add(eye);
    eyesOpen.push(eye);
    const lid = box(0.09, 0.015, 0.02, black);
    lid.position.set(x, 0.05, -0.27);
    lid.visible = false;
    head.add(lid);
    eyesClosed.push(lid);
  }
  // kulaklar: Claude = dik (shiba), Google = sarkik
  for (const s of [-1, 1]) {
    if (provider === "claude") {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 4), dark);
      ear.position.set(0.17 * s, 0.27, 0.02);
      ear.rotation.z = -0.25 * s;
      ear.castShadow = true;
      head.add(ear);
    } else {
      const ear = ball(0.12, dark, 0.45, 1.1, 0.8);
      ear.position.set(0.27 * s, 0.0, 0.02);
      ear.rotation.z = 0.25 * s;
      head.add(ear);
    }
  }
  if (lead) {
    const tie = box(0.1, 0.26, 0.04, mat(0xc0392b));
    tie.position.set(0, 0.42, -0.52);
    body.add(tie);
    root.scale.setScalar(1.15);
  }
  body.add(head);
  return { root, body, head, tail, eyesOpen, eyesClosed, materials, phase: Math.random() * Math.PI * 2 };
}

function poseDog(dog: Dog, state: OfficeState) {
  const sleeping = state === "idle" || state === "planned";
  dog.body.position.y = sleeping ? -0.12 : 0;
  dog.head.rotation.set(sleeping ? 0.55 : -0.05, 0, 0);
  for (const e of dog.eyesOpen) e.visible = !sleeping;
  for (const e of dog.eyesClosed) e.visible = sleeping;
  const faded = state === "planned";
  for (const m of dog.materials) {
    m.transparent = faded;
    m.opacity = faded ? 0.45 : 1;
    m.emissive = new THREE.Color(state === "failed" ? 0x661111 : 0x000000);
  }
}

// ------------------------------------------------------------------ ofis
type Seat = {
  agent: OfficeAgent;
  group: THREE.Group;
  dog: Dog;
  screen: THREE.MeshStandardMaterial;
  bubble: THREE.Sprite | null;
  ring: THREE.Mesh;
};

export class DogOffice {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private world = new THREE.Group();
  private seats = new Map<string, Seat>();
  private approvals: THREE.Object3D | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private frame = 0;
  private active = true;
  private selected: string | null = null;
  private resize: ResizeObserver;
  private key = "";
  private framed = false;

  constructor(private host: HTMLElement, private opts: OfficeOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.camera.position.set(0, 19, 24);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = 1.25;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 55;

    this.scene.add(this.world);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8d8a80, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(12, 22, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const s = sun.shadow.camera as THREE.OrthographicCamera;
    s.left = s.bottom = -26;
    s.right = s.top = 26;
    this.scene.add(sun);
    this.setTheme(opts.dark);

    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("click", this.onClick);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
    this.loop();
  }

  setTheme(dark: boolean) {
    this.opts.dark = dark;
    this.scene.background = new THREE.Color(dark ? 0x17181c : 0xeef0f4);
    if (this.key) {
      const agents = [...this.seats.values()].map((s) => s.agent);
      this.key = "";
      this.setAgents(agents, this.lastPending);
    }
  }

  setActive(active: boolean) {
    this.active = active;
    if (active) this.clock.getDelta();
  }

  private lastPending = 0;

  /** Rol listesi degisince ofisi yeniden kurar; sadece durum degisince pozlari gunceller. */
  setAgents(agents: OfficeAgent[], pending: number) {
    this.lastPending = pending;
    const key = agents.map((a) => `${a.id}:${a.team}:${a.provider}:${a.label}`).join("|") + `|${this.opts.dark}`;
    if (key !== this.key) {
      this.key = key;
      this.build(agents);
    }
    for (const a of agents) {
      const seat = this.seats.get(a.id);
      if (!seat) continue;
      seat.agent = a;
      poseDog(seat.dog, a.state);
      seat.screen.emissive = new THREE.Color(a.state === "working" ? 0x2dd4bf : a.state === "failed" ? 0xef4444 : a.state === "blocked" ? 0xf59e0b : 0x0c0d10);
      seat.screen.emissiveIntensity = a.state === "idle" || a.state === "planned" ? 0.2 : 1.1;
      if (seat.bubble) seat.group.remove(seat.bubble);
      seat.bubble = this.bubbleFor(a.state);
      if (seat.bubble) {
        seat.bubble.position.set(0.62, 2.25, -0.95);
        seat.group.add(seat.bubble);
      }
    }
    this.setApprovals(pending);
  }

  select(id: string | null) {
    this.selected = id;
    for (const [sid, seat] of this.seats) seat.ring.visible = sid === id;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("click", this.onClick);
    this.controls.dispose();
    this.clear();
    this.renderer.dispose();
    el.remove();
  }

  // ---------------------------------------------------------------- kurulum
  private clear() {
    this.world.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const x of mats) {
        (x as THREE.SpriteMaterial).map?.dispose?.();
        x.dispose();
      }
    });
    this.world.clear();
    this.seats.clear();
    this.approvals = null;
    this.approvalsAnchor = null;
  }

  private build(agents: OfficeAgent[]) {
    this.clear();
    const dark = this.opts.dark;
    const byTeam = new Map<string, OfficeAgent[]>();
    for (const a of agents) byTeam.set(a.team, [...(byTeam.get(a.team) ?? []), a]);
    const teams = [...byTeam.keys()].sort((a, b) => (TEAM_ORDER.indexOf(a) + 9) % 9 - (TEAM_ORDER.indexOf(b) + 9) % 9);

    // her oda: sutun = min(4, n); 2x2 izgara
    const sizes = teams.map((t) => {
      const n = byTeam.get(t)!.length;
      const cols = Math.min(4, Math.max(1, n));
      const rows = Math.ceil(n / cols);
      return { t, cols, rows, w: cols * DESK_W + 1.4, d: rows * DESK_D + 1.4 };
    });
    const gap = 1.6;
    const colW = [0, 0];
    const rowD = [0, 0];
    sizes.forEach((s, i) => {
      colW[i % 2] = Math.max(colW[i % 2], s.w);
      rowD[Math.floor(i / 2)] = Math.max(rowD[Math.floor(i / 2)], s.d);
    });
    const totalW = colW[0] + colW[1] + gap;
    const totalD = rowD[0] + (rowD[1] || 0) + gap;

    // zemin
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(totalW + 8, totalD + 8), mat(dark ? 0x1f2127 : 0xe2e4ea));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.world.add(floor);

    sizes.forEach((s, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x0 = -totalW / 2 + (col === 0 ? 0 : colW[0] + gap) + (colW[col] - s.w) / 2;
      const z0 = -totalD / 2 + (row === 0 ? 0 : rowD[0] + gap) + (rowD[row] - s.d) / 2;
      const room = new THREE.Group();
      room.position.set(x0, 0, z0);
      this.world.add(room);

      const [lightC, darkC] = TEAM_FLOOR[s.t] ?? [0xe5e5e5, 0x2a2a2a];
      const base = box(s.w, 0.16, s.d, mat(dark ? darkC : lightC));
      base.position.set(s.w / 2, 0.08, s.d / 2);
      base.castShadow = false;
      room.add(base);
      const wallM = mat(dark ? 0x2c2f37 : 0xffffff);
      const back = box(s.w, 0.9, 0.12, wallM);
      back.position.set(s.w / 2, 0.6, 0.06);
      room.add(back);
      const side = box(0.12, 0.9, s.d, wallM);
      side.position.set(0.06, 0.6, s.d / 2);
      room.add(side);
      const sign = textSprite(TEAM_NAME[s.t] ?? s.t, { bg: dark ? "#e9ecf2" : "#1b1d23", fg: dark ? "#1b1d23" : "#ffffff", size: 48, bold: true });
      sign.position.set(s.w / 2, 0.55, s.d + 0.45);
      room.add(sign);
      // bitki
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.4, 12), mat(0xb5651d));
      pot.position.set(s.w - 0.45, 0.36, 0.45);
      room.add(pot);
      const leaf = ball(0.38, mat(0x3f9c5a), 1, 1.3, 1);
      leaf.position.set(s.w - 0.45, 0.95, 0.45);
      room.add(leaf);

      byTeam.get(s.t)!.forEach((a, k) => {
        const c = k % s.cols;
        const r = Math.floor(k / s.cols);
        const seat = this.makeSeat(a);
        seat.group.position.set(0.7 + c * DESK_W + DESK_W / 2, 0.16, 1.9 + r * DESK_D);
        room.add(seat.group);
        this.seats.set(a.id, seat);
        if (a.lead && !this.approvals) this.approvalsAnchor = seat.group;
      });
    });
    this.controls.target.set(0, 0.5, 0);
    if (!this.framed) {
      // ilk acilista tum ofisi kadraja al
      const dist = Math.max(totalW * 1.0, totalD * 1.4, 12);
      this.camera.position.set(dist * 0.12, dist * 0.95, dist * 0.78);
      this.framed = true;
    }
    this.select(this.selected);
  }

  private approvalsAnchor: THREE.Group | null = null;

  private makeSeat(a: OfficeAgent): Seat {
    const group = new THREE.Group();
    const wood = mat(this.opts.dark ? 0x6b4f3a : 0xc9a27a);
    const top = box(1.9, 0.1, 0.95, wood);
    top.position.set(0, 0.78, 0);
    group.add(top);
    for (const [x, z] of [[-0.85, -0.38], [0.85, -0.38], [-0.85, 0.38], [0.85, 0.38]]) {
      const leg = box(0.08, 0.76, 0.08, wood);
      leg.position.set(x, 0.38, z);
      group.add(leg);
    }
    // dizustu bilgisayar (alcak: kopegin kafasi ustunden gorunur); ekran kopege bakar
    const frameM = mat(0x2a2c33);
    const base = box(0.62, 0.03, 0.42, frameM);
    base.position.set(0, 0.845, -0.05);
    group.add(base);
    const lid = new THREE.Group();
    lid.position.set(0, 0.86, 0.16);
    lid.rotation.x = 0.28;
    const back = box(0.62, 0.4, 0.025, frameM);
    back.position.set(0, 0.2, 0);
    lid.add(back);
    const screen = new THREE.MeshStandardMaterial({ color: 0x0c0d10, emissive: 0x0c0d10, emissiveIntensity: 0.2, roughness: 0.4 });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.34), screen);
    glass.position.set(0, 0.2, -0.014);
    glass.rotation.y = Math.PI;
    lid.add(glass);
    group.add(lid);
    // kahve kupasi
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 12), mat(0xf4f4f4));
    mug.position.set(0.62, 0.9, 0.05);
    group.add(mug);
    // tabure + minder + kopek (masanin arkasinda, kameraya/laptopa bakar)
    const seatColor = a.provider === "google" ? 0x5b7bd5 : a.provider === "claude" ? 0xd97706 : 0x9aa0a6;
    const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.5, 18), mat(this.opts.dark ? 0x3a3d45 : 0x9ca3af));
    stool.position.set(0, 0.25, -0.95);
    stool.castShadow = true;
    group.add(stool);
    const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 20), mat(seatColor));
    cushion.position.set(0, 0.54, -0.95);
    group.add(cushion);
    const dog = makeDog(a.provider, !!a.lead);
    dog.root.position.set(0, 0.58, -0.95);
    dog.root.rotation.y = Math.PI;
    group.add(dog.root);
    // gorunmez tiklama alani (kopek + masa)
    const hitBox = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hitBox.position.set(0, 1.2, -0.45);
    group.add(hitBox);
    // secim halkasi (zeminde)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 8, 40), new THREE.MeshBasicMaterial({ color: 0x2dd4bf }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.04, -0.5);
    ring.visible = false;
    group.add(ring);
    // isim etiketi
    const tag = textSprite(`${a.number} · ${a.label}`, { bg: this.opts.dark ? "#2b2d34" : "#ffffff", fg: this.opts.dark ? "#eceef3" : "#1b1d23", size: 28 });
    tag.position.set(0, 2.95, -0.95);
    group.add(tag);
    group.traverse((o) => (o.userData.agentId = a.id));
    return { agent: a, group, dog, screen, bubble: null, ring };
  }

  private bubbleFor(state: OfficeState): THREE.Sprite | null {
    const d = this.opts.dark;
    if (state === "idle") return textSprite("Zz", { bg: d ? "#33363e" : "#e9ecf2", fg: "#8a90a0", size: 30, bold: true });
    if (state === "working") return textSprite("···", { bg: "#2dd4bf", fg: "#0b2b27", size: 30, bold: true });
    if (state === "done") return textSprite("✓", { bg: "#22c55e", fg: "#ffffff", size: 30, bold: true });
    if (state === "blocked") return textSprite("!", { bg: "#f59e0b", fg: "#1b1d23", size: 30, bold: true });
    if (state === "failed") return textSprite("✗", { bg: "#ef4444", fg: "#ffffff", size: 30, bold: true });
    if (state === "planned") return textSprite("planlı", { bg: d ? "#33363e" : "#e9ecf2", fg: "#8a90a0", size: 24 });
    return null;
  }

  private setApprovals(n: number) {
    if (this.approvals) {
      this.approvals.parent?.remove(this.approvals);
      this.approvals = null;
    }
    if (!n || !this.approvalsAnchor) return;
    const g = new THREE.Group();
    const tray = box(0.5, 0.1, 0.36, mat(0xf59e0b));
    tray.position.set(0.68, 0.88, -0.15);
    g.add(tray);
    for (let i = 0; i < Math.min(n, 4); i++) {
      const paper = box(0.42, 0.02, 0.3, mat(0xffffff));
      paper.position.set(0.68, 0.95 + i * 0.03, -0.15);
      g.add(paper);
    }
    const label = textSprite(`📋 ${n} onay bekliyor`, { bg: "#f59e0b", fg: "#1b1d23", size: 28, bold: true });
    label.position.set(0.9, 1.9, 0.3);
    g.add(label);
    g.traverse((o) => {
      o.userData.approvals = true;
      delete o.userData.agentId;
    });
    this.approvalsAnchor.add(g);
    this.approvals = g;
  }

  // ---------------------------------------------------------------- etkilesim
  private hit(e: MouseEvent): Hit | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const x of this.raycaster.intersectObjects(this.world.children, true)) {
      if (x.object.userData.approvals) return { kind: "approvals" };
      if (x.object.userData.agentId) return { kind: "agent", id: x.object.userData.agentId };
    }
    return null;
  }

  private onMove = (e: PointerEvent) => {
    this.renderer.domElement.style.cursor = this.hit(e) ? "pointer" : "grab";
  };

  private onClick = (e: MouseEvent) => {
    const h = this.hit(e);
    if (h?.kind === "agent") this.select(h.id);
    this.opts.onSelect(h);
  };

  private fit() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    if (!this.active) return;
    const t = this.clock.getElapsedTime();
    for (const seat of this.seats.values()) {
      const { dog, agent } = seat;
      const p = t * 2 + dog.phase;
      const s = agent.state;
      if (s === "idle" || s === "planned") {
        dog.body.scale.y = 1 + Math.sin(p * 0.6) * 0.03; // nefes
        dog.tail.rotation.y = 0;
      } else {
        dog.body.scale.y = 1;
        dog.head.rotation.x = s === "working" ? -0.05 + Math.sin(p * 3) * 0.08 : s === "blocked" ? 0.1 : -0.05;
        dog.head.rotation.z = s === "blocked" ? 0.3 : 0;
        dog.tail.rotation.y = s === "done" || s === "working" ? Math.sin(p * (s === "done" ? 6 : 3)) * 0.6 : 0;
      }
      if (seat.bubble) seat.bubble.position.y = 2.25 + Math.sin(p) * 0.06;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
