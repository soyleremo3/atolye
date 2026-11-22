/**
 * Kopek ofisi v2: krem bir masa maketi uzerinde her ajanin kendi odasi; odada masa, laptop, kopek yatagi,
 * hali, bitki, cerceve. Kopek durumunu yumusak gecislerle gosterir. Her sey prosedureldir (dosya/model yok).
 *  uyuyor  = yataginda kivrilir, nefes alir, "z" yukselir
 *  calisiyor = sandalyede laptopa bakar, patileri yazar, ekran parlar; yoneticiden is noktalari akar
 *  bitti   = kuyruk sallar, bir kez ziplar · takildi = kafa egik · hata = kulaklar duser · planli = soluk oda
 * Kartlar HTML (CSS2DRenderer): net yazi, buzlu cam gorunumu.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

export type OfficeState = "idle" | "working" | "done" | "failed" | "blocked" | "planned";
export type OfficeAgent = {
  id: string;
  number: string;
  label: string;
  team: string;
  provider: "claude" | "google" | "none";
  state: OfficeState;
  lead?: boolean;
  /** Kartin ikinci satiri: "uyuyor · 3 sa once" ya da canli is. */
  line: string;
};
export type OfficeHit = { kind: "agent"; id: string } | { kind: "approvals" };
export type OfficeOptions = { onSelect: (hit: OfficeHit | null) => void };

// ------------------------------------------------------------------ palet
const TEAM_ORDER = ["lead", "developer", "sales", "general"];
const TEAM_WALLS: Record<string, number[]> = {
  lead: [0xef8f78, 0xe9a07a, 0xe58a8a, 0xf0a48c],
  developer: [0x7ea6e6, 0x9a8ae6, 0x6fb6dc, 0x8d9ee8, 0xa58fd8, 0x76a9d6],
  sales: [0xf2bb52, 0xef9f55, 0xe8c45f, 0xf0ad62],
  general: [0x6cc39a, 0x52b7a9, 0x8ccb6e, 0x5fbfb4],
};
const C = {
  floor: 0xf6ecdc,
  base: 0xeedcc0,
  baseSide: 0xdcc6a2,
  wood: 0xd9b48a,
  woodDark: 0xb98f63,
  cream: 0xfaf3e6,
  white: 0xffffff,
  ink: 0x3a3330,
  leaf: [0x7cc36a, 0x5fae5a, 0x9ad07a],
  pot: 0xd98a5b,
};
const DOG = {
  claude: { coat: 0xe39a4f, light: 0xfbe4c6, dark: 0xa8612b, collar: 0xe8603c },
  google: { coat: 0x8ea3c0, light: 0xf0f3f8, dark: 0x4f607a, collar: 0x4f7be0 },
  none: { coat: 0xc9bfae, light: 0xf5f0e6, dark: 0x8a8070, collar: 0x9aa0a6 },
};

const ROOM = 4.4;
const GAP = 0.45;
const WALL_H = 1.5;
const WALL_T = 0.14;

// ------------------------------------------------------------------ yardimcilar
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, extra: { flat?: boolean; emissive?: number; opacity?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${extra.flat ? 1 : 0}|${extra.emissive ?? ""}|${extra.opacity ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: 0.82, metalness: 0, flatShading: !!extra.flat,
      emissive: extra.emissive ?? 0x000000, transparent: (extra.opacity ?? 1) < 1, opacity: extra.opacity ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
}

function rbox(w: number, h: number, d: number, m: THREE.Material, r = 0.05) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function sph(r: number, m: THREE.Material, s: [number, number, number] = [1, 1, 1], seg = 24) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7)), m);
  mesh.scale.set(...s);
  mesh.castShadow = true;
  return mesh;
}

function cyl(rt: number, rb: number, h: number, m: THREE.Material, seg = 20) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Canvas dokusu (hali deseni, zemin yazisi). */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
function shade(n: number, k: number) {
  const c = new THREE.Color(n);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + k)));
  return c.getHex();
}

function rugTexture(color: number) {
  return canvasTexture(512, 320, (g) => {
    g.fillStyle = hex(color);
    g.fillRect(0, 0, 512, 320);
    g.strokeStyle = hex(shade(color, 0.28));
    g.lineWidth = 10;
    g.strokeRect(18, 18, 476, 284);
    g.fillStyle = hex(shade(color, 0.32));
    for (let x = 30; x < 490; x += 22) {
      g.beginPath();
      g.arc(x, 34, 3.5, 0, Math.PI * 2);
      g.arc(x, 286, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 4; i++) {
      const cx = 100 + i * 104;
      g.fillStyle = hex(shade(color, 0.22));
      g.beginPath();
      g.moveTo(cx, 80);
      g.lineTo(cx + 44, 160);
      g.lineTo(cx, 240);
      g.lineTo(cx - 44, 160);
      g.closePath();
      g.fill();
      g.fillStyle = hex(shade(color, -0.08));
      g.beginPath();
      g.moveTo(cx, 120);
      g.lineTo(cx + 22, 160);
      g.lineTo(cx, 200);
      g.lineTo(cx - 22, 160);
      g.closePath();
      g.fill();
    }
  });
}

function floorText(text: string, color: number) {
  const t = canvasTexture(1024, 160, (g) => {
    g.font = '800 96px "Segoe UI", system-ui, sans-serif';
    g.fillStyle = hex(shade(color, -0.25));
    g.globalAlpha = 0.55;
    g.textBaseline = "middle";
    g.fillText(text.toLocaleUpperCase("tr"), 24, 84, 980);
  });
  const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.56), m);
  plane.rotation.x = -Math.PI / 2;
  return plane;
}

function plant(scale = 1) {
  const g = new THREE.Group();
  const pot = cyl(0.2, 0.15, 0.3, mat(C.pot));
  pot.position.y = 0.15;
  g.add(pot);
  const trunk = cyl(0.035, 0.045, 0.45, mat(C.woodDark));
  trunk.position.y = 0.5;
  g.add(trunk);
  const leaves = [[0, 0.95, 0, 0.34], [0.12, 0.78, 0.06, 0.24], [-0.1, 0.82, -0.05, 0.22], [0.02, 1.18, 0.02, 0.22]];
  leaves.forEach(([x, y, z, r], i) => {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(C.leaf[i % 3], { flat: true }));
    leaf.position.set(x, y, z);
    leaf.rotation.set(i, i * 2, 0);
    leaf.castShadow = true;
    g.add(leaf);
  });
  g.scale.setScalar(scale);
  return g;
}

function frame(color: number) {
  const g = new THREE.Group();
  const f = rbox(0.5, 0.62, 0.04, mat(C.white), 0.015);
  g.add(f);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.5), mat(shade(color, 0.12)));
  art.position.z = 0.022;
  g.add(art);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), mat(shade(color, -0.2)));
  dot.position.set(0.04, 0.06, 0.024);
  g.add(dot);
  return g;
}

// ------------------------------------------------------------------ kopek
type Pose = { x: number; y: number; z: number; rot: number; sit: number; curl: number; head: number; tilt: number; ears: number };
type Dog = {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  earL: THREE.Object3D;
  earR: THREE.Object3D;
  tail: THREE.Group;
  pawL: THREE.Object3D;
  pawR: THREE.Object3D;
  eyesOpen: THREE.Object3D[];
  eyesShut: THREE.Object3D[];
  pose: Pose;
  phase: number;
};

function makeDog(provider: OfficeAgent["provider"], lead: boolean): Dog {
  const c = DOG[provider];
  const coat = mat(c.coat);
  const light = mat(c.light);
  const dark = mat(c.dark);
  const ink = mat(0x2a2422);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = sph(0.3, coat, [1, 0.86, 1.22]);
  torso.position.set(0, 0.32, 0.05);
  body.add(torso);
  const belly = sph(0.22, light, [1, 0.9, 1]);
  belly.position.set(0, 0.3, -0.16);
  body.add(belly);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 10, 24), mat(c.collar));
  collar.position.set(0, 0.5, -0.24);
  collar.rotation.x = 1.2;
  body.add(collar);
  const tag = sph(0.04, mat(0xf7d26a), [1, 1, 0.5]);
  tag.position.set(0, 0.4, -0.36);
  body.add(tag);
  for (const s of [-1, 1]) {
    const hip = sph(0.13, coat, [0.9, 1, 1.1]);
    hip.position.set(0.17 * s, 0.17, 0.22);
    body.add(hip);
    const foot = sph(0.075, light, [1, 0.6, 1.4]);
    foot.position.set(0.17 * s, 0.03, 0.1);
    body.add(foot);
  }
  const paws: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(0.12 * s, 0.34, -0.24);
    const limb = cyl(0.055, 0.06, 0.3, coat, 12);
    limb.position.y = -0.15;
    leg.add(limb);
    const paw = sph(0.07, light, [1, 0.65, 1.3]);
    paw.position.set(0, -0.3, -0.03);
    leg.add(paw);
    body.add(leg);
    paws.push(leg);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.36, 0.38);
  const t1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.22, 4, 10), provider === "claude" ? light : coat);
  t1.position.set(0, 0.12, 0.08);
  t1.rotation.x = -0.75;
  t1.castShadow = true;
  tail.add(t1);
  body.add(tail);
  const head = new THREE.Group();
  head.position.set(0, 0.66, -0.26);
  head.add(sph(0.27, coat, [1.05, 0.95, 1]));
  const muzzle = sph(0.15, light, [1.1, 0.82, 1.05]);
  muzzle.position.set(0, -0.07, -0.19);
  head.add(muzzle);
  const nose = sph(0.05, ink, [1.25, 0.85, 1]);
  nose.position.set(0, -0.02, -0.33);
  head.add(nose);
  const eyesOpen: THREE.Object3D[] = [];
  const eyesShut: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const eye = sph(0.045, ink, [1, 1.15, 0.7], 16);
    eye.position.set(0.1 * s, 0.06, -0.225);
    head.add(eye);
    const shine = sph(0.014, mat(C.white), [1, 1, 1], 8);
    shine.position.set(0.1 * s + 0.012, 0.075, -0.255);
    head.add(shine);
    eyesOpen.push(eye, shine);
    const lid = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 12, Math.PI), ink);
    lid.position.set(0.1 * s, 0.055, -0.235);
    lid.rotation.set(0, 0, Math.PI);
    lid.visible = false;
    head.add(lid);
    eyesShut.push(lid);
    const blush = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), mat(0xf6a6a0, { opacity: 0.7 }));
    blush.position.set(0.17 * s, -0.04, -0.205);
    blush.rotation.y = s * 0.5;
    head.add(blush);
  }
  const ears: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.17 * s, 0.17, 0.02);
    if (provider === "claude") {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 4), dark);
      ear.position.y = 0.08;
      ear.rotation.z = -0.2 * s;
      ear.castShadow = true;
      pivot.add(ear);
    } else {
      const ear = sph(0.1, dark, [0.45, 1.15, 0.8], 14);
      ear.position.set(0.05 * s, -0.08, 0);
      pivot.add(ear);
    }
    head.add(pivot);
    ears.push(pivot);
  }
  body.add(head);
  root.scale.setScalar(lead ? 1.5 : 1.35);
  return {
    root, body, head, earL: ears[0], earR: ears[1], tail, pawL: paws[0], pawR: paws[1], eyesOpen, eyesShut,
    pose: { x: 0, y: 0, z: 0, rot: 0, sit: 0, curl: 1, head: 0.5, tilt: 0, ears: 0 }, phase: Math.random() * 10,
  };
}

// ------------------------------------------------------------------ oda
type Room = {
  agent: OfficeAgent;
  group: THREE.Group;
  dog: Dog;
  screen: THREE.MeshStandardMaterial;
  floorMat: THREE.MeshStandardMaterial;
  outline: THREE.LineSegments;
  card: HTMLDivElement;
  cardObj: CSS2DObject;
  zs: THREE.Sprite[];
  bang: THREE.Sprite;
  bedPos: THREE.Vector3;
  chairPos: THREE.Vector3;
  deskTop: THREE.Vector3;
  hopUntil: number;
  prevState: OfficeState | null;
};

function letterSprite(text: string, color: string, bg?: string) {
  const t = canvasTexture(128, 128, (g) => {
    if (bg) {
      g.fillStyle = bg;
      g.beginPath();
      g.arc(64, 64, 56, 0, Math.PI * 2);
      g.fill();
    }
    g.font = '800 84px "Segoe UI", system-ui, sans-serif';
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 64, 70);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(0.32, 0.32, 1);
  return s;
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

// ------------------------------------------------------------------ ofis
export class DogOffice {
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private world = new THREE.Group();
  private rooms = new Map<string, Room>();
  private sparks: { mesh: THREE.Mesh; to: string; t: number }[] = [];
  private sparkGeo = new THREE.SphereGeometry(0.09, 12, 8);
  private sparkMat = new THREE.MeshBasicMaterial({ color: 0xff7a45, transparent: true, opacity: 0.95 });
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private frameId = 0;
  private active = true;
  private selected: string | null = null;
  private resize: ResizeObserver;
  private key = "";
  private bounds = { w: 20, d: 20 };
  private approvalsTray: THREE.Group | null = null;
  private sun: THREE.DirectionalLight;
  private insets = { left: 300, right: 330 };
  private hovered: string | null = null;
  private showAllLabels = true;

  /** Yan paneller acilip kapaninca maketin sigacagi alan. */
  setInsets(left: number, right: number) {
    this.insets = { left, right };
    this.fit();
  }

  /** Tum kartlar mi, yalniz onemliler mi (calisan, takilan, biten, yonetici, secili, uzerine gelinen). */
  setShowAllLabels(all: boolean) {
    this.showAllLabels = all;
  }

  private updateLabels() {
    const zoomed = this.camera.zoom > 1.45;
    for (const [id, room] of this.rooms) {
      const st = room.agent.state;
      const important = st === "working" || st === "blocked" || st === "failed" || st === "done" || !!room.agent.lead;
      const show = this.showAllLabels || zoomed || important || id === this.selected || id === this.hovered;
      // CSS2DRenderer her karede display'i nesnenin visible degerine gore kurar
      room.cardObj.visible = show;
    }
  }

  constructor(private host: HTMLElement, private opts: OfficeOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = "office-labels";
    host.appendChild(this.labels.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minZoom = 0.55;
    this.controls.maxZoom = 3.2;
    this.controls.minPolarAngle = 0.62;
    this.controls.maxPolarAngle = 1.05;
    this.controls.screenSpacePanning = true;

    this.scene.add(this.world);
    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0xd9c2a0, 1.35));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
    sun.position.set(-14, 26, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0xffe2c8, 0.45);
    fill.position.set(18, 10, -8);
    this.scene.add(fill);

    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("click", this.onClick);
    el.addEventListener("dblclick", this.onDouble);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
    this.loop();
  }

  setActive(active: boolean) {
    this.active = active;
    this.labels.domElement.style.display = active ? "" : "none";
    if (active) this.clock.getDelta();
  }

  /** Ajan listesi degisince maketi yeniden kurar; sadece durum/yazi degisince odayi gunceller. */
  setAgents(agents: OfficeAgent[], pending: number) {
    const key = agents.map((a) => `${a.id}:${a.team}:${a.provider}:${a.label}:${a.lead ? 1 : 0}:${a.state === "planned" ? 1 : 0}`).join("|");
    if (key !== this.key) {
      this.key = key;
      this.build(agents);
    }
    for (const a of agents) {
      const room = this.rooms.get(a.id);
      if (!room) continue;
      if (room.prevState && room.prevState !== "done" && a.state === "done") room.hopUntil = this.clock.getElapsedTime() + 1.2;
      room.prevState = a.state;
      room.agent = a;
      this.renderCard(room);
    }
    this.setApprovals(pending);
  }

  private flyTo: { target: THREE.Vector3; zoom: number } | null = null;

  /** Odaya yumusakca yaklas (cift tik ya da "Odaya git"). id yoksa tum maket. */
  focus(id: string | null, zoom = 2.6) {
    if (!id) {
      this.flyTo = { target: new THREE.Vector3(0, 0, 0), zoom: 1 };
      return;
    }
    const room = this.rooms.get(id);
    if (!room) return;
    const p = new THREE.Vector3(ROOM / 2, 0.6, ROOM / 2);
    room.group.localToWorld(p);
    this.flyTo = { target: p, zoom };
  }

  private onDouble = (e: MouseEvent) => {
    const h = this.hit(e);
    if (h?.kind === "agent") this.focus(this.camera.zoom > 2 && this.selected === h.id ? null : h.id);
  };

  /** Testler ve panel icin: odanin su anki durumu. */
  stateOf(id: string): OfficeState | null {
    return this.rooms.get(id)?.agent.state ?? null;
  }

  select(id: string | null) {
    this.selected = id;
    for (const [rid, room] of this.rooms) {
      room.outline.visible = rid === id;
      room.card.classList.toggle("sel", rid === id);
    }
  }

  dispose() {
    cancelAnimationFrame(this.frameId);
    this.resize.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("click", this.onClick);
    el.removeEventListener("dblclick", this.onDouble);
    this.controls.dispose();
    this.clear();
    this.sparkGeo.dispose();
    this.sparkMat.dispose();
    this.renderer.dispose();
    el.remove();
    this.labels.domElement.remove();
  }

  // ---------------------------------------------------------------- kurulum
  private clear() {
    for (const room of this.rooms.values()) room.cardObj.removeFromParent();
    for (const s of this.sparks) s.mesh.removeFromParent();
    this.sparks = [];
    this.world.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && m.geometry !== this.sparkGeo) m.geometry.dispose();
      if ((o as THREE.Sprite).isSprite) {
        const sm = (o as THREE.Sprite).material;
        sm.map?.dispose();
        sm.dispose();
      }
      const bm = m.material as THREE.MeshBasicMaterial | undefined;
      if (m.isMesh && bm && !Array.isArray(bm) && bm.map) bm.map.dispose();
    });
    this.world.clear();
    this.rooms.clear();
    this.approvalsTray = null;
  }

  private build(agents: OfficeAgent[]) {
    this.clear();
    const sorted = [...agents].sort((a, b) => {
      const ta = TEAM_ORDER.indexOf(a.team);
      const tb = TEAM_ORDER.indexOf(b.team);
      return (ta < 0 ? 9 : ta) - (tb < 0 ? 9 : tb) || (a.lead ? -1 : b.lead ? 1 : 0);
    });
    const cols = Math.max(3, Math.min(6, Math.ceil(Math.sqrt(sorted.length))));
    const rows = Math.ceil(sorted.length / cols);
    const w = cols * ROOM + (cols - 1) * GAP;
    const d = rows * ROOM + (rows - 1) * GAP;
    this.bounds = { w, d };

    const pad = 1.3;
    const base = rbox(w + pad * 2, 0.7, d + pad * 2, mat(C.base), 0.35);
    base.position.set(0, -0.35, 0);
    base.castShadow = false;
    this.world.add(base);
    const plinth = rbox(w + pad * 2 + 0.5, 0.35, d + pad * 2 + 0.5, mat(C.baseSide), 0.2);
    plinth.position.set(0, -0.82, 0);
    plinth.castShadow = false;
    this.world.add(plinth);

    const teamCount = new Map<string, number>();
    sorted.forEach((a, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const k = teamCount.get(a.team) ?? 0;
      teamCount.set(a.team, k + 1);
      const walls = TEAM_WALLS[a.team] ?? [0xc9c2b6];
      const room = this.makeRoom(a, walls[k % walls.length], i);
      room.group.position.set(-w / 2 + c * (ROOM + GAP), 0, -d / 2 + r * (ROOM + GAP));
      this.world.add(room.group);
      this.rooms.set(a.id, room);
    });

    const s = this.sun.shadow.camera as THREE.OrthographicCamera;
    const half = Math.max(w, d) / 2 + 4;
    s.left = s.bottom = -half;
    s.right = s.top = half;
    s.near = 1;
    s.far = 80;
    s.updateProjectionMatrix();

    this.controls.target.set(0, 0, 0);
    const dist = 60;
    this.camera.position.set(dist * 0.62, dist * 0.78, dist * 0.82);
    this.camera.zoom = 1;
    this.fit();
    this.select(this.selected);
  }

  private makeRoom(a: OfficeAgent, wallColor: number, index: number): Room {
    const g = new THREE.Group();
    const faded = a.state === "planned";
    const wallM = mat(faded ? shade(wallColor, 0.18) : wallColor);
    const trimM = mat(shade(wallColor, -0.12));

    const floorMat = new THREE.MeshStandardMaterial({ color: faded ? 0xece4d6 : C.floor, roughness: 0.9 });
    const floor = new THREE.Mesh(new RoundedBoxGeometry(ROOM, 0.12, ROOM, 2, 0.04), floorMat);
    floor.position.set(ROOM / 2, 0.06, ROOM / 2);
    floor.receiveShadow = true;
    g.add(floor);
    const back = rbox(ROOM, WALL_H, WALL_T, wallM, 0.04);
    back.position.set(ROOM / 2, WALL_H / 2 + 0.12, WALL_T / 2);
    g.add(back);
    const left = rbox(WALL_T, WALL_H, ROOM, wallM, 0.04);
    left.position.set(WALL_T / 2, WALL_H / 2 + 0.12, ROOM / 2);
    g.add(left);
    const capB = rbox(ROOM, 0.06, WALL_T + 0.04, trimM, 0.02);
    capB.position.set(ROOM / 2, WALL_H + 0.15, WALL_T / 2);
    g.add(capB);
    const capL = rbox(WALL_T + 0.04, 0.06, ROOM, trimM, 0.02);
    capL.position.set(WALL_T / 2, WALL_H + 0.15, ROOM / 2);
    g.add(capL);

    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.45), new THREE.MeshStandardMaterial({ map: rugTexture(wallColor), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(2.15, 0.125, 3.2);
    rug.receiveShadow = true;
    g.add(rug);
    const label = floorText(a.label, wallColor);
    label.position.set(2.05, 0.126, ROOM - 0.32);
    g.add(label);

    const deskTop = new THREE.Vector3(2.5, 0.86, 1.25);
    const top = rbox(1.7, 0.08, 0.8, mat(C.wood), 0.03);
    top.position.copy(deskTop);
    g.add(top);
    for (const [x, z] of [[-0.75, -0.32], [0.75, -0.32], [-0.75, 0.32], [0.75, 0.32]]) {
      const leg = rbox(0.06, 0.76, 0.06, mat(C.woodDark), 0.02);
      leg.position.set(deskTop.x + x, 0.5, deskTop.z + z);
      g.add(leg);
    }
    const laptopM = mat(0xdedad3);
    const lbase = rbox(0.56, 0.03, 0.38, laptopM, 0.015);
    lbase.position.set(deskTop.x, deskTop.y + 0.055, deskTop.z + 0.02);
    g.add(lbase);
    const lid = new THREE.Group();
    lid.position.set(deskTop.x, deskTop.y + 0.07, deskTop.z + 0.2);
    lid.rotation.x = 0.32;
    const lback = rbox(0.56, 0.36, 0.025, laptopM, 0.015);
    lback.position.y = 0.18;
    lid.add(lback);
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), mat(0xbfb9ae));
    logo.position.set(0, 0.2, 0.014);
    lid.add(logo);
    const screen = new THREE.MeshStandardMaterial({ color: 0x1d2330, emissive: 0x000000, roughness: 0.4 });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), screen);
    glass.position.set(0, 0.18, -0.014);
    glass.rotation.y = Math.PI;
    lid.add(glass);
    g.add(lid);
    const lampBase = cyl(0.08, 0.1, 0.03, mat(C.ink));
    lampBase.position.set(deskTop.x + 0.62, deskTop.y + 0.055, deskTop.z - 0.18);
    g.add(lampBase);
    const lampArm = cyl(0.015, 0.015, 0.32, mat(C.ink), 8);
    lampArm.position.set(deskTop.x + 0.62, deskTop.y + 0.22, deskTop.z - 0.18);
    g.add(lampArm);
    const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.13, 16, 1, true), mat(0xf6e3b0, { emissive: 0x6b5520 }));
    lampShade.position.set(deskTop.x + 0.62, deskTop.y + 0.4, deskTop.z - 0.18);
    g.add(lampShade);
    const mug = cyl(0.055, 0.05, 0.11, mat(shade(wallColor, 0.15)), 14);
    mug.position.set(deskTop.x - 0.6, deskTop.y + 0.1, deskTop.z + 0.12);
    g.add(mug);
    const chairPos = new THREE.Vector3(deskTop.x, 0.6, deskTop.z - 0.78);
    const chairM = mat(shade(wallColor, -0.05));
    const seat = rbox(0.62, 0.08, 0.56, chairM, 0.04);
    seat.position.set(chairPos.x, 0.52, chairPos.z);
    g.add(seat);
    const backrest = rbox(0.62, 0.55, 0.07, chairM, 0.04);
    backrest.position.set(chairPos.x, 0.86, chairPos.z - 0.27);
    g.add(backrest);
    const post = cyl(0.04, 0.04, 0.4, mat(C.ink), 8);
    post.position.set(chairPos.x, 0.3, chairPos.z);
    g.add(post);
    const foot = cyl(0.25, 0.25, 0.04, mat(C.ink), 16);
    foot.position.set(chairPos.x, 0.14, chairPos.z);
    g.add(foot);

    const bedPos = new THREE.Vector3(1.0, 0.16, 3.1);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.14, 14, 32), mat(shade(wallColor, 0.08)));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(bedPos.x, 0.22, bedPos.z);
    ring.castShadow = true;
    ring.receiveShadow = true;
    g.add(ring);
    const cushion = cyl(0.42, 0.44, 0.1, mat(C.cream), 28);
    cushion.position.set(bedPos.x, 0.16, bedPos.z);
    g.add(cushion);

    const p = plant(index % 3 === 0 ? 1.15 : 0.95);
    p.position.set(ROOM - 0.45, 0.12, 0.5);
    g.add(p);
    for (let i = 0; i < 2; i++) {
      const f = frame(index % 2 ? 0x8fb7e8 : 0xf2b6a0);
      f.position.set(0.95 + i * 0.68, 1.12, WALL_T + 0.02);
      g.add(f);
    }
    if (a.team === "developer" && index % 2 === 0) {
      const rack = rbox(0.6, 1.25, 0.55, mat(0x2f3440), 0.05);
      rack.position.set(0.5, 0.75, 1.9);
      g.add(rack);
      for (let i = 0; i < 5; i++) {
        const led = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.04), mat(0x3ddc97, { emissive: 0x1f8f5c }));
        led.position.set(0.81, 0.35 + i * 0.2, 1.9);
        led.rotation.y = Math.PI / 2;
        g.add(led);
      }
    } else {
      const shelf = rbox(0.34, 0.06, 1.1, mat(C.wood), 0.02);
      shelf.position.set(WALL_T + 0.17, 1.15, 1.9);
      g.add(shelf);
      [0xe8603c, 0x4f7be0, 0xf2bb52, 0x6cc39a].forEach((col, i) => {
        const book = rbox(0.22, 0.26 + (i % 2) * 0.06, 0.08, mat(col), 0.01);
        book.position.set(WALL_T + 0.17, 1.32, 1.55 + i * 0.2);
        g.add(book);
      });
    }
    if (a.lead) {
      const board = rbox(1.3, 0.75, 0.05, mat(C.white), 0.03);
      board.position.set(ROOM - 1.25, 1.05, WALL_T + 0.04);
      g.add(board);
      [0xe8603c, 0x4f7be0, 0x3ddc97].forEach((col, i) => {
        const note = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), mat(col));
        note.position.set(ROOM - 1.65 + i * 0.4, 1.1, WALL_T + 0.07);
        g.add(note);
      });
    }

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(ROOM + 0.08, 0.02, ROOM + 0.08)),
      new THREE.LineBasicMaterial({ color: 0xff7a45 }),
    );
    outline.position.set(ROOM / 2, 0.14, ROOM / 2);
    outline.visible = false;
    g.add(outline);

    const dog = makeDog(a.provider, !!a.lead);
    g.add(dog.root);
    dog.pose.x = bedPos.x;
    dog.pose.y = 0.2;
    dog.pose.z = bedPos.z;

    const zs = [0, 1, 2].map(() => {
      const z = letterSprite("z", "#8a7f74");
      z.visible = false;
      g.add(z);
      return z;
    });
    const bang = letterSprite("!", "#ffffff", "#f59e0b");
    bang.visible = false;
    g.add(bang);

    const card = document.createElement("div");
    card.className = "office-card";
    card.addEventListener("click", (e) => {
      e.stopPropagation();
      this.select(a.id);
      this.opts.onSelect({ kind: "agent", id: a.id });
    });
    const cardObj = new CSS2DObject(card);
    cardObj.position.set(2.2, WALL_H + 0.9, 0.9);
    g.add(cardObj);

    g.traverse((o) => {
      o.userData.agentId = a.id;
    });
    return { agent: a, group: g, dog, screen, floorMat, outline, card, cardObj, zs, bang, bedPos, chairPos, deskTop, hopUntil: 0, prevState: null };
  }

  private renderCard(room: Room) {
    const a = room.agent;
    const st = a.state;
    const mark = st === "working" ? '<i class="dot live"></i>' : st === "done" ? '<i class="ok">✓</i>' : st === "blocked" ? '<i class="warn">!</i>' : st === "failed" ? '<i class="bad">✗</i>' : "";
    const quiet = st === "idle" || st === "planned";
    room.card.className = `office-card st-${st} pv-${a.provider}${quiet ? " quiet" : ""}${this.selected === a.id ? " sel" : ""}`;
    room.card.title = `${a.number} · ${a.label} — ${a.line}`;
    // uyuyan/planli: tek satirlik kucuk etiket (ad + kisa durum); digerleri iki satir, renkli
    room.card.innerHTML = quiet
      ? `<b>${escHtml(a.number)} · ${escHtml(a.label)}</b><span>${st === "planned" ? "planlı" : "uyuyor"}</span>`
      : `<b>${escHtml(a.number)} · ${escHtml(a.label)}</b><span>${mark}${escHtml(a.line)}</span>`;
  }

  private setApprovals(n: number) {
    if (this.approvalsTray) {
      this.approvalsTray.removeFromParent();
      this.approvalsTray = null;
    }
    const lead = [...this.rooms.values()].find((r) => r.agent.lead);
    if (!n || !lead) return;
    const tray = new THREE.Group();
    tray.add(rbox(0.42, 0.08, 0.3, mat(0xf59e0b), 0.02));
    for (let i = 0; i < Math.min(n, 4); i++) {
      const paper = rbox(0.36, 0.02, 0.26, mat(C.white), 0.005);
      paper.position.y = 0.06 + i * 0.025;
      tray.add(paper);
    }
    tray.position.set(lead.deskTop.x - 0.55, lead.deskTop.y + 0.06, lead.deskTop.z - 0.15);
    tray.traverse((o) => {
      o.userData.approvals = true;
      delete o.userData.agentId;
    });
    lead.group.add(tray);
    this.approvalsTray = tray;
  }

  // ---------------------------------------------------------------- etkilesim
  private hit(e: MouseEvent): OfficeHit | null {
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
    const h = this.hit(e);
    this.hovered = h?.kind === "agent" ? h.id : null;
    this.renderer.domElement.style.cursor = h ? "pointer" : "grab";
  };

  private onClick = (e: MouseEvent) => {
    const h = this.hit(e);
    if (h?.kind === "agent") this.select(h.id);
    this.opts.onSelect(h);
  };

  /**
   * Maketi yan paneller arasindaki bos alana sigdirir: tabanin koselerini kamera uzayina izdusurur,
   * sonra ortografik cerceveyi o kutu ekranin kullanilabilir ortasina gelecek sekilde kurar.
   */
  private fit() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld(true);
    const hw = this.bounds.w / 2 + 1.6;
    const hd = this.bounds.d / 2 + 1.6;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const v = new THREE.Vector3();
    for (const x of [-hw, hw]) for (const z of [-hd, hd]) for (const y of [-1, WALL_H + 2.2]) {
      v.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    // kullanilabilir alan (piksel): soldaki ozet karti ve sagdaki panel haric
    const x0 = Math.min(this.insets.left, w * 0.3);
    const x1 = w - Math.min(this.insets.right, w * 0.3);
    const y0 = 56;
    const y1 = h - 16;
    const s = Math.max((maxX - minX) / Math.max(80, x1 - x0), (maxY - minY) / Math.max(80, y1 - y0));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.camera.left = cx - ((x0 + x1) / 2) * s;
    this.camera.right = this.camera.left + w * s;
    this.camera.top = cy + ((y0 + y1) / 2) * s;
    this.camera.bottom = this.camera.top - h * s;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- animasyon
  private targetPose(room: Room): Pose {
    const st = room.agent.state;
    if (st === "working" || st === "blocked")
      return { x: room.chairPos.x, y: 0.58, z: room.chairPos.z + 0.04, rot: 0, sit: 1, curl: 0, head: st === "blocked" ? 0.15 : -0.12, tilt: st === "blocked" ? 0.38 : 0, ears: 0 };
    if (st === "done") return { x: room.bedPos.x + 0.9, y: 0.12, z: room.bedPos.z - 0.35, rot: 0.35, sit: 1, curl: 0, head: -0.1, tilt: 0, ears: 0 };
    if (st === "failed") return { x: room.bedPos.x + 0.9, y: 0.12, z: room.bedPos.z - 0.35, rot: 0.2, sit: 0.4, curl: 0, head: 0.45, tilt: 0, ears: 1 };
    return { x: room.bedPos.x, y: 0.2, z: room.bedPos.z, rot: 0.9, sit: 0, curl: 1, head: 0.55, tilt: 0, ears: 0.4 };
  }

  private animateDog(room: Room, t: number, dt: number) {
    const dog = room.dog;
    const goal = this.targetPose(room);
    const k = 1 - Math.exp(-dt * 3.2);
    const p = dog.pose;
    (Object.keys(goal) as (keyof Pose)[]).forEach((key) => {
      p[key] += (goal[key] - p[key]) * k;
    });
    const st = room.agent.state;
    const ph = t + dog.phase;
    const hop = room.hopUntil > t ? Math.sin((1 - (room.hopUntil - t) / 1.2) * Math.PI) * 0.35 : 0;
    dog.root.position.set(p.x, p.y + hop, p.z);
    dog.root.rotation.y = Math.PI + p.rot;
    const breathe = 1 + Math.sin(ph * 1.6) * (p.curl > 0.5 ? 0.035 : 0.015);
    dog.body.scale.set(1 + p.curl * 0.12, (1 - p.curl * 0.28) * breathe, 1 - p.curl * 0.1);
    // oturus: govde geriye yatar (gogus yukari), kafa telafi edip ileri bakar
    // (model -z'ye bakar; +x donusu gogsu kaldirir)
    dog.body.rotation.x = p.sit * 0.85;
    dog.head.rotation.x = p.head - p.sit * 0.8 + (st === "working" ? Math.sin(ph * 5) * 0.06 : 0);
    dog.head.rotation.z = p.tilt;
    dog.head.position.y = 0.66 - p.curl * 0.22;
    dog.earL.rotation.z = p.ears * 0.6;
    dog.earR.rotation.z = -p.ears * 0.6;
    const wag = st === "done" ? 9 : st === "working" ? 4 : 0;
    dog.tail.rotation.y = wag ? Math.sin(ph * wag) * 0.7 : dog.tail.rotation.y * 0.9;
    dog.tail.rotation.x = st === "failed" ? 0.9 : 0;
    const typing = st === "working" ? 1 : 0;
    // on patiler oturusta ileri (masaya) uzanir; yazarken sirayla iner kalkar
    dog.pawL.rotation.x = p.sit * 0.35 + typing * Math.max(0, Math.sin(ph * 12)) * 0.3;
    dog.pawR.rotation.x = p.sit * 0.35 + typing * Math.max(0, Math.sin(ph * 12 + Math.PI)) * 0.3;
    const sleeping = p.curl > 0.6;
    for (const e of dog.eyesOpen) e.visible = !sleeping;
    for (const e of dog.eyesShut) e.visible = sleeping;
    const glow = st === "working" ? 0.65 + Math.sin(ph * 3) * 0.2 : st === "blocked" ? 0.5 : st === "failed" ? 0.45 : 0;
    room.screen.emissive.setHex(st === "blocked" ? 0xf59e0b : st === "failed" ? 0xef4444 : 0x7fe3d0);
    room.screen.emissiveIntensity = glow;
    room.zs.forEach((z, i) => {
      z.visible = sleeping && st !== "planned";
      if (!z.visible) return;
      const c = (((ph * 0.35 + i / 3) % 1) + 1) % 1;
      z.position.set(room.bedPos.x + 0.25 + c * 0.35, 0.75 + c * 0.9, room.bedPos.z - 0.1);
      z.material.opacity = Math.sin(c * Math.PI);
      const s = 0.18 + c * 0.2;
      z.scale.set(s, s, 1);
    });
    room.bang.visible = st === "blocked";
    if (room.bang.visible) {
      room.bang.position.set(p.x + 0.45, 1.75 + Math.sin(ph * 4) * 0.05, p.z);
      const s = 0.32 + Math.sin(ph * 6) * 0.03;
      room.bang.scale.set(s, s, 1);
    }
  }

  /** Calisan her ajana yoneticinin masasindan turuncu is noktalari akar. */
  private animateSparks(dt: number) {
    const lead = [...this.rooms.values()].find((r) => r.agent.lead);
    if (!lead) return;
    const working = [...this.rooms.values()].filter((r) => r.agent.state === "working" && r !== lead);
    const want = new Set(working.map((r) => r.agent.id));
    for (const r of working) {
      const have = this.sparks.filter((s) => s.to === r.agent.id).length;
      for (let i = have; i < 3; i++) {
        const mesh = new THREE.Mesh(this.sparkGeo, this.sparkMat);
        this.world.add(mesh);
        this.sparks.push({ mesh, to: r.agent.id, t: i / 3 });
      }
    }
    this.sparks = this.sparks.filter((s) => {
      if (want.has(s.to)) return true;
      s.mesh.removeFromParent();
      return false;
    });
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const s of this.sparks) {
      const to = this.rooms.get(s.to);
      if (!to) continue;
      s.t = (s.t + dt * 0.35) % 1;
      lead.group.localToWorld(a.copy(lead.deskTop).setY(1.1));
      to.group.localToWorld(b.copy(to.deskTop).setY(1.1));
      const mid = a.clone().lerp(b, 0.5).setY(Math.max(a.y, b.y) + 2.2 + a.distanceTo(b) * 0.08);
      const u = s.t;
      const pos = a.clone().multiplyScalar((1 - u) * (1 - u)).add(mid.multiplyScalar(2 * (1 - u) * u)).add(b.clone().multiplyScalar(u * u));
      this.world.worldToLocal(pos);
      s.mesh.position.copy(pos);
      s.mesh.scale.setScalar(0.7 + Math.sin(u * Math.PI) * 0.6);
    }
  }

  private loop = () => {
    this.frameId = requestAnimationFrame(this.loop);
    if (!this.active) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.getElapsedTime();
    for (const room of this.rooms.values()) this.animateDog(room, t, dt);
    this.updateLabels();
    this.animateSparks(dt);
    if (this.flyTo) {
      // hedefe yumusak ucus: kamera hedefle birlikte kayar, zoom yaklasir
      const k = 1 - Math.exp(-dt * 4);
      const delta = this.flyTo.target.clone().sub(this.controls.target).multiplyScalar(k);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
      this.camera.zoom += (this.flyTo.zoom - this.camera.zoom) * k;
      this.camera.updateProjectionMatrix();
      if (delta.length() < 0.002 && Math.abs(this.flyTo.zoom - this.camera.zoom) < 0.01) this.flyTo = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };
}
