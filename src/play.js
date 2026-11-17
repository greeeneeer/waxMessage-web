// 깨기 화면: 왁스로 덮인 3D 비누. 탭하면 그 자리 왁스가 떨어지고 주변에 금이 간다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PALETTE, SOAP, LABEL } from './share.js';
import { drawLabel, ensureFont } from './label.js';
import { roundedBox, buildWaxChunks, OUTER } from './geometry.js';
import * as sound from './sound.js';

// 한 번 탭에 떨어지는 반경 / 금이 가는 반경. 윗면을 약 10번 탭하면 다 깨지도록 맞춘 값.
const BREAK_R = 0.62;
const CRACK_R = 1.1;
const FINISH_AT = 0.85; // 윗면 조각이 이만큼 떨어지면 나머지가 한꺼번에 와르르

const INTACT = 0, CRACKED = 1, FALLING = 2, GONE = 3;

export async function startPlay(data) {
  const $ = (id) => document.getElementById(id);
  const canvas = $('scene');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const viewDir = new THREE.Vector3(0, 0.8, 0.62).normalize();
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = 1.3;
  controls.rotateSpeed = 0.8;

  // 빛과 바닥 그림자
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2.5, 7, 3.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0xeedccc, 0.35));

  const floorY = -OUTER.h / 2;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.ShadowMaterial({ opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  scene.add(floor);

  // 비누 + 인쇄된 글씨
  const soapGroup = new THREE.Group();
  scene.add(soapGroup);
  const soap = new THREE.Mesh(
    roundedBox(SOAP.w, SOAP.h, SOAP.d, SOAP.r, 6),
    new THREE.MeshStandardMaterial({ color: PALETTE.clay[data.c][0], roughness: 0.85 }),
  );
  soap.castShadow = soap.receiveShadow = true;
  soapGroup.add(soap);

  await ensureFont(data.f, data.t);
  const lc = document.createElement('canvas');
  lc.width = 1024;
  lc.height = Math.round((1024 * LABEL.d) / LABEL.w);
  drawLabel(lc.getContext('2d'), lc.width, lc.height, data);
  const tex = new THREE.CanvasTexture(lc);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(LABEL.w, LABEL.d),
    // 투명 처리 대신 alphaTest: 불투명 물체처럼 먼저 그려져서 반투명 왁스 뒤에서 깨지지 않는다
    new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.35, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  label.rotation.x = -Math.PI / 2;
  label.position.y = SOAP.h / 2 + 0.003;
  label.receiveShadow = true;
  soapGroup.add(label);

  // 왁스 조각들
  const waxMat = new THREE.MeshPhysicalMaterial({
    color: PALETTE.wax[data.w][0],
    vertexColors: true,
    roughness: 0.3,
    clearcoat: 0.7,
    clearcoatRoughness: 0.25,
    transparent: true,
    opacity: 0.9,
  });
  const chunks = buildWaxChunks(110).map((c) => {
    const mesh = new THREE.Mesh(c.body, waxMat);
    mesh.position.copy(c.center);
    mesh.castShadow = true;
    let wall = null;
    if (c.wall) {
      wall = new THREE.Mesh(c.wall, waxMat);
      wall.visible = false;
      mesh.add(wall);
    }
    scene.add(mesh);
    return {
      ...c, mesh, wall,
      state: INTACT,
      top: c.normal.y > 0.5,
      bottom: c.normal.y < -0.6,
      vel: new THREE.Vector3(), spin: new THREE.Vector3(),
      age: 0, delay: -1, landed: false,
    };
  });
  const topTotal = chunks.filter((c) => c.top).length;

  // 화면 크기에 맞춰 카메라 거리 조정 (비누 가로가 화면에 다 들어오게)
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(2.3 / tanV, 2.1 / (tanV * camera.aspect));
    const dir = camera.position.lengthSq() > 0 ? camera.position.clone().normalize() : viewDir;
    camera.position.copy(dir).multiplyScalar(dist);
    controls.minDistance = dist * 0.55;
    controls.maxDistance = dist * 1.6;
    controls.update();
  }
  window.addEventListener('resize', resize);
  resize();

  // 탭 판별 (끌기는 돌려보기)
  let down = null;
  canvas.addEventListener('pointerdown', (e) => {
    sound.unlock();
    down = e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || !e.isPrimary) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved < 9 && performance.now() - down.t < 450) tap(e.clientX, e.clientY);
    down = null;
  });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let finished = false;
  let taps = 0;

  function tap(x, y) {
    if (finished) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const alive = chunks.filter((c) => c.state < FALLING);
    const hit = raycaster.intersectObjects(alive.map((c) => c.mesh), false)[0];
    if (!hit) return;

    taps++;
    $('hint').classList.add('gone');
    const p = hit.point;
    let fell = 0;
    for (const c of alive) {
      const d = c.center.distanceTo(p);
      if (c.mesh === hit.object || d < BREAK_R || (c.state === CRACKED && d < BREAK_R * 1.45)) {
        fall(c, p);
        fell++;
      } else if (d < CRACK_R && c.state === INTACT) {
        crack(c);
      }
    }
    sound.crack(fell);
    navigator.vibrate?.(fell > 3 ? [14, 30, 14] : 14);

    const topGone = chunks.filter((c) => c.top && c.state >= FALLING).length;
    if (topGone / topTotal >= FINISH_AT) {
      finished = true;
      setTimeout(finale, 260);
    }
  }

  // 금 가기: 살짝 들뜨고 비틀어져 틈과 단면이 보인다
  function crack(c) {
    c.state = CRACKED;
    if (c.wall) c.wall.visible = true;
    c.mesh.position.copy(c.center).addScaledVector(c.normal, 0.018 + Math.random() * 0.015);
    c.mesh.rotation.set((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08);
  }

  function fall(c, from) {
    c.state = FALLING;
    c.age = 0;
    if (c.wall) c.wall.visible = true;
    // 비누 중심에서 바깥쪽 + 탭한 곳에서 멀어지는 쪽으로 튕겨 나간다
    const out = new THREE.Vector3(c.center.x, 0, c.center.z);
    if (out.lengthSq() < 0.01) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    out.normalize();
    const away = c.center.clone().sub(from).setY(0);
    if (away.lengthSq() > 1e-4) away.normalize();
    c.vel
      .copy(c.normal).multiplyScalar(0.8 + Math.random() * 0.9)
      .addScaledVector(out, 1.6 + Math.random() * 1.6)
      .addScaledVector(away, 0.6 + Math.random() * 0.6);
    c.vel.y += 1.4 + Math.random() * 1.2;
    c.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
  }

  function finale() {
    for (const c of chunks) {
      if (c.state >= FALLING) continue;
      if (c.bottom) { c.state = GONE; c.mesh.visible = false; continue; }
      c.state = FALLING;
      c.pending = true;
      c.delay = Math.random() * 0.45;
    }
    sound.crack(8);
    sound.crack(5, 0.18);
    navigator.vibrate?.([20, 40, 20, 40, 30]);
    setTimeout(() => { addSparkles(); popT = 0; }, 650);
    setTimeout(() => $('done').classList.add('show'), 1500);
  }

  // 반짝이
  const sparkles = [];
  let popT = -1;
  function addSparkles() {
    const sc = document.createElement('canvas');
    sc.width = sc.height = 64;
    const g = sc.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,240,200,0.8)');
    grad.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = grad;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const rr = i % 2 ? 7 : 32;
      g.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr);
    }
    g.fill();
    const sTex = new THREE.CanvasTexture(sc);
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.position.set((Math.random() - 0.5) * LABEL.w * 1.1, SOAP.h / 2 + 0.05 + Math.random() * 0.45, (Math.random() - 0.5) * LABEL.d * 1.1);
      s.userData = { phase: Math.random() * Math.PI * 2, speed: 3 + Math.random() * 4, size: 0.12 + Math.random() * 0.18 };
      scene.add(s);
      sparkles.push(s);
    }
  }

  // 버튼
  $('again').addEventListener('click', () => location.reload());
  $('make').addEventListener('click', () => (location.href = location.pathname));
  let muted = false;
  $('mute').addEventListener('click', () => {
    muted = !muted;
    sound.setMuted(muted);
    $('mute').textContent = muted ? '🔇' : '🔊';
    $('mute').setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
  });

  // 매 프레임
  const clock = new THREE.Clock();
  const topY = SOAP.h / 2 + 0.02;
  function frame() {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const time = clock.elapsedTime;

    for (const c of chunks) {
      if (c.state !== FALLING) continue;
      if (c.pending) {
        c.delay -= dt;
        if (c.delay > 0) continue;
        c.pending = false;
        fall(c, new THREE.Vector3(0, -0.2, 0));
      }
      const m = c.mesh;
      const prevY = m.position.y;
      c.vel.y -= 9.8 * dt;
      m.position.addScaledVector(c.vel, dt);
      m.rotation.x += c.spin.x * dt;
      m.rotation.y += c.spin.y * dt;
      m.rotation.z += c.spin.z * dt;

      // 비누 윗면이나 바닥에 닿으면 톡 튀고 미끄러진다
      const onSoap = Math.abs(m.position.x) < SOAP.w / 2 && Math.abs(m.position.z) < SOAP.d / 2;
      const ground = onSoap && prevY >= topY ? topY : onSoap ? null : floorY + 0.03;
      if (ground !== null && m.position.y < ground && c.vel.y < 0) {
        m.position.y = ground;
        c.vel.y *= -0.28;
        c.vel.x *= 0.65;
        c.vel.z *= 0.65;
        c.spin.multiplyScalar(0.5);
        if (!c.landed) { c.landed = true; sound.tick(); }
      }

      c.age += dt;
      if (c.age > 1.6) {
        const s = 1 - (c.age - 1.6) / 0.5;
        if (s <= 0) { c.state = GONE; m.visible = false; scene.remove(m); }
        else m.scale.setScalar(s);
      }
    }

    // 다 깨진 뒤: 비누가 통 튀고 글씨 주변이 반짝인다
    if (popT >= 0) {
      popT += dt;
      soapGroup.scale.setScalar(1 + 0.06 * Math.sin(popT * 14) * Math.exp(-popT * 3));
    }
    for (const s of sparkles) {
      const u = s.userData;
      const v = Math.max(0, Math.sin(time * u.speed + u.phase));
      s.material.opacity = v;
      s.scale.setScalar(u.size * (0.4 + v));
    }

    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();
  $('loading').classList.add('gone');

  // 확인용 (개발자 도구에서 몇 번 만에 깨졌는지 볼 수 있음)
  window.__wax = { get taps() { return taps; }, chunks, tap, camera, canvas };
}
