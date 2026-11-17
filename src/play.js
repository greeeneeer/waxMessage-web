// 깨기 화면: 불투명한 왁스로 덮인 3D 비누. 탭하면 그 자리 왁스가 파편으로 떨어지고 주변에 금이 간다.
// 안쪽 클레이는 단단한 편이라 누른 자리만 살짝 들어간다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PALETTE, SOAP, LABEL } from './share.js';
import { drawLabel, ensureFont } from './label.js';
import { soapGeometry, buildWaxChunks, OUTER } from './geometry.js';
import * as sound from './sound.js';

// 한 번 탭에 떨어지는 반경 / 금이 가는 반경. 윗면을 약 10번 탭하면 다 깨지도록 맞춘 값.
const BREAK_R = 0.62;
const CRACK_R = 1.1;
const FINISH_AT = 0.85; // 윗면 조각이 이만큼 떨어지면 나머지가 한꺼번에 떨어진다

// 클레이 눌림: 반경, 한 번에 들어가는 깊이, 최대 깊이 (작을수록 단단한 클레이)
const DENT_R = 0.5;
const DENT_DEPTH = 0.03;
const DENT_MAX = 0.07;

const INTACT = 0, CRACKED = 1, FALLING = 2, GONE = 3;
const UP = new THREE.Vector3(0, 1, 0);

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
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0xeedccc, 0.35));

  const floorY = -OUTER.h / 2;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 48), new THREE.ShadowMaterial({ opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  scene.add(floor);

  // 비누: 윗면에 글씨가 인쇄된 텍스처 (바탕은 클레이 색)
  await ensureFont(data.f, data.t);
  const clay = PALETTE.clay[data.c][0];
  const tc = document.createElement('canvas');
  tc.width = 1024;
  tc.height = Math.round((1024 * LABEL.d) / LABEL.w);
  const lc = document.createElement('canvas');
  lc.width = tc.width;
  lc.height = tc.height;
  drawLabel(lc.getContext('2d'), lc.width, lc.height, data);
  const tctx = tc.getContext('2d');
  tctx.fillStyle = clay;
  tctx.fillRect(0, 0, tc.width, tc.height);
  tctx.drawImage(lc, 0, 0);
  const tex = new THREE.CanvasTexture(tc);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const soapGeo = soapGeometry();
  const soap = new THREE.Mesh(soapGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  soap.castShadow = soap.receiveShadow = true;
  scene.add(soap);
  const restPos = soapGeo.attributes.position.array.slice();
  const restNrm = soapGeo.attributes.normal.array.slice();
  const dents = new Float32Array(soapGeo.attributes.position.count);

  // 왁스 파편들 (불투명)
  const waxMat = new THREE.MeshPhysicalMaterial({
    color: PALETTE.wax[data.w][0],
    vertexColors: true,
    roughness: 0.38,
    clearcoat: 0.5,
    clearcoatRoughness: 0.35,
    side: THREE.DoubleSide,
  });
  const chunks = buildWaxChunks(90).map((c) => {
    const mesh = new THREE.Mesh(c.body, waxMat);
    mesh.position.copy(c.center);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (c.wall) mesh.add(new THREE.Mesh(c.wall, waxMat));
    scene.add(mesh);
    return {
      ...c, mesh,
      state: INTACT,
      top: c.normal.y > 0.5,
      bottom: c.normal.y < -0.6,
      vel: new THREE.Vector3(), spin: new THREE.Vector3(),
      delay: 0, pending: false, onFloor: false, rest: null, restY: 0, still: 0,
    };
  });
  const topTotal = chunks.filter((c) => c.top).length;

  // 왁스 가루
  const DUST = 900;
  const dustPos = new Float32Array(DUST * 3).fill(-100);
  const dustVel = new Float32Array(DUST * 3);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: PALETTE.wax[data.w][0], size: 0.03 }));
  dust.frustumCulled = false;
  scene.add(dust);
  let dustNext = 0;
  function spray(p, n, count) {
    for (let k = 0; k < count; k++) {
      const i = dustNext++ % DUST;
      dustPos[i * 3] = p.x + (Math.random() - 0.5) * 0.3;
      dustPos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.1;
      dustPos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.3;
      dustVel[i * 3] = n.x * 1.2 + (Math.random() - 0.5) * 2;
      dustVel[i * 3 + 1] = n.y * 1.2 + Math.random() * 1.5;
      dustVel[i * 3 + 2] = n.z * 1.2 + (Math.random() - 0.5) * 2;
    }
  }

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
  let squash = 1;

  function tap(x, y) {
    if (finished) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const alive = chunks.filter((c) => c.state < FALLING);
    const hit = raycaster.intersectObjects(alive.map((c) => c.mesh), true)[0];
    if (!hit) return;
    const hitMesh = hit.object.parent?.isMesh && hit.object.parent !== scene ? hit.object.parent : hit.object;

    taps++;
    const p = hit.point;
    let fell = 0;
    for (const c of alive) {
      const d = c.center.distanceTo(p);
      if (c.mesh === hitMesh || d < BREAK_R || (c.state === CRACKED && d < BREAK_R * 1.45)) {
        fall(c, p);
        fell++;
      } else if (d < CRACK_R && c.state === INTACT) {
        crack(c);
      }
    }
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : UP;
    spray(p, n, 30 + fell * 6);
    dent(p);
    sound.crack(fell);
    navigator.vibrate?.(fell > 3 ? [14, 30, 14] : 14);

    const topGone = chunks.filter((c) => c.top && c.state >= FALLING).length;
    if (topGone / topTotal >= FINISH_AT) {
      finished = true;
      setTimeout(finale, 260);
    }
  }

  // 누른 자리의 클레이가 살짝 들어간다 (돌아오지 않음)
  function dent(p) {
    const pos = soapGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const dx = restPos[i * 3] - p.x, dy = restPos[i * 3 + 1] - p.y, dz = restPos[i * 3 + 2] - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d >= DENT_R) continue;
      const f = (1 - (d / DENT_R) ** 2) ** 2;
      dents[i] = Math.min(DENT_MAX, dents[i] + DENT_DEPTH * f);
      pos.setXYZ(
        i,
        restPos[i * 3] - restNrm[i * 3] * dents[i],
        restPos[i * 3 + 1] - restNrm[i * 3 + 1] * dents[i],
        restPos[i * 3 + 2] - restNrm[i * 3 + 2] * dents[i],
      );
    }
    pos.needsUpdate = true;
    soapGeo.computeVertexNormals();
    squash = 0.975;
  }

  // 금 가기: 살짝 들뜨고 비틀어져 틈이 보인다
  function crack(c) {
    c.state = CRACKED;
    c.mesh.position.copy(c.center).addScaledVector(c.normal, 0.015 + Math.random() * 0.015);
    c.mesh.rotation.set((Math.random() - 0.5) * 0.07, (Math.random() - 0.5) * 0.07, (Math.random() - 0.5) * 0.07);
  }

  function fall(c, from) {
    c.state = FALLING;
    // 비누 중심에서 바깥쪽 + 탭한 곳에서 멀어지는 쪽으로 튕겨 나간다
    const out = new THREE.Vector3(c.center.x, 0, c.center.z);
    if (out.lengthSq() < 0.01) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    out.normalize();
    const away = c.center.clone().sub(from).setY(0);
    if (away.lengthSq() > 1e-4) away.normalize();
    c.vel
      .copy(c.normal).multiplyScalar(0.6 + Math.random() * 0.8)
      .addScaledVector(out, 1.4 + Math.random() * 1.4)
      .addScaledVector(away, 0.5 + Math.random() * 0.5);
    c.vel.y += 1.2 + Math.random() * 1.0;
    c.spin.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10);
  }

  // 바닥에 닿으면 납작하게 눕는다 (바깥면이 위로 오는 경우가 많게)
  function settleTarget(c) {
    const faceUp = Math.random() < 0.65 ? UP : UP.clone().negate();
    const q = new THREE.Quaternion().setFromUnitVectors(c.normal, faceUp);
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2));
    // 누운 자세에서 가장 낮은 점이 바닥에 닿도록 높이 계산
    const pos = c.body.attributes.position;
    const v = new THREE.Vector3();
    let minY = Infinity;
    for (let i = 0; i < pos.count; i += 3) minY = Math.min(minY, v.fromBufferAttribute(pos, i).applyQuaternion(q).y);
    c.rest = q;
    c.restY = floorY - minY + Math.random() * 0.004;
  }

  function finale() {
    for (const c of chunks) {
      if (c.state >= FALLING) continue;
      if (c.bottom) { c.state = GONE; c.mesh.visible = false; continue; }
      c.state = FALLING;
      c.pending = true;
      c.delay = Math.random() * 0.5;
    }
    sound.crack(8);
    sound.crack(5, 0.18);
    navigator.vibrate?.([20, 40, 20, 40, 30]);
    setTimeout(() => $('done').classList.add('show'), 1600);
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
  const topY = SOAP.h / 2 + 0.01;
  const spinQ = new THREE.Quaternion();
  const spinE = new THREE.Euler();
  function frame() {
    const dt = Math.min(clock.getDelta(), 1 / 30);

    for (const c of chunks) {
      if (c.state !== FALLING) continue;
      if (c.pending) {
        c.delay -= dt;
        if (c.delay > 0) continue;
        c.pending = false;
        fall(c, new THREE.Vector3(0, -0.2, 0));
      }
      const m = c.mesh;

      if (c.onFloor) {
        // 바닥에서 미끄러지다 멈추며 납작하게 눕는다
        m.position.x += c.vel.x * dt;
        m.position.z += c.vel.z * dt;
        c.vel.multiplyScalar(Math.exp(-6 * dt));
        const k = 1 - Math.exp(-12 * dt);
        m.quaternion.slerp(c.rest, k);
        m.position.y += (c.restY - m.position.y) * k;
        c.still += dt;
        if (c.still > 1.5) c.state = GONE; // 다 멈춤: 더 계산하지 않고 그대로 둔다
        continue;
      }

      const prevY = m.position.y;
      c.vel.y -= 9.8 * dt;
      m.position.addScaledVector(c.vel, dt);
      spinE.set(c.spin.x * dt, c.spin.y * dt, c.spin.z * dt);
      m.quaternion.multiply(spinQ.setFromEuler(spinE));

      // 비누 윗면에 떨어지면 튕겨서 바깥으로 미끄러져 내려간다
      const onSoap = Math.abs(m.position.x) < SOAP.w / 2 && Math.abs(m.position.z) < SOAP.d / 2;
      if (onSoap && prevY >= topY && m.position.y < topY && c.vel.y < 0) {
        m.position.y = topY;
        c.vel.y *= -0.3;
        const out = new THREE.Vector3(m.position.x, 0, m.position.z).normalize();
        c.vel.addScaledVector(out, 1.5);
        sound.tick();
      } else if (!onSoap && m.position.y < floorY + 0.05 && c.vel.y < 0) {
        c.onFloor = true;
        c.vel.y = 0;
        c.vel.x *= 0.5;
        c.vel.z *= 0.5;
        settleTarget(c);
        sound.tick();
      }
    }

    // 가루
    let dustMoved = false;
    for (let i = 0; i < DUST; i++) {
      if (dustPos[i * 3 + 1] <= floorY + 0.012) continue;
      dustVel[i * 3 + 1] -= 9.8 * dt;
      dustPos[i * 3] += dustVel[i * 3] * dt;
      dustPos[i * 3 + 1] += dustVel[i * 3 + 1] * dt;
      dustPos[i * 3 + 2] += dustVel[i * 3 + 2] * dt;
      if (dustPos[i * 3 + 1] < floorY + 0.012) dustPos[i * 3 + 1] = floorY + 0.011;
      dustMoved = true;
    }
    if (dustMoved) dustGeo.attributes.position.needsUpdate = true;

    // 누를 때 살짝 납작해졌다 돌아오기
    squash += (1 - squash) * (1 - Math.exp(-14 * dt));
    soap.scale.set(1 + (1 - squash) * 0.5, squash, 1 + (1 - squash) * 0.5);

    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();
  $('loading').classList.add('gone');

  // 확인용 (개발자 도구에서 몇 번 만에 깨졌는지 볼 수 있음)
  window.__wax = { get taps() { return taps; }, chunks, tap, camera, canvas };
}
