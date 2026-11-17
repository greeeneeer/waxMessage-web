// 깨기 화면: 불투명한 왁스로 덮인 비누 덩어리가 공중에 비스듬히 떠 있다.
// - 덩어리를 꾹 누르면: 누른 자리 주변 왁스에 금이 가고 들뜬다 (클레이가 살짝 눌린다)
// - 금 간 왁스를 한 번 더 누르면: 그 파편들이 바닥으로 떨어진다
// - 덩어리를 끌면 덩어리가 돌아가고, 바깥(배경)을 끌면 카메라 시점이 돈다
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PALETTE, SOAP, LABEL } from './share.js';
import { drawLabel, ensureFont } from './label.js';
import { soapGeometry, buildWaxChunks, OUTER } from './geometry.js';
import * as sound from './sound.js';

// 깨지는 정도: 꾹 눌러 금이 가는 반경 / 금 간 파편을 눌러 함께 떨어지는 반경. 20~30번 누르면 다 깨지도록 맞춘 값.
const CRACK_R = 1.05;
const DROP_R = 1.15;
const FINISH_AT = 0.9; // 전체 파편이 이만큼 떨어지면 남은 것도 다 떨어진다
const HOLD_MS = 420; // 이만큼 누르고 있으면 '꾹'

// 클레이 눌림 (작을수록 단단한 클레이)
const DENT_R = 0.5;
const DENT_DEPTH = 0.03;
const DENT_MAX = 0.07;

const LUMP_Y = 0.3; // 덩어리가 떠 있는 높이 (바닥은 그 아래)
const FLOOR_Y = -1.9;

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
  const viewDir = new THREE.Vector3(0, 0.55, 0.84).normalize();

  // 누르기·끌기 입력은 OrbitControls보다 먼저 받아야 해서 컨트롤을 만들기 전에 등록한다
  let press = null;
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = 1.45;
  controls.rotateSpeed = 0.8;

  // 빛과 바닥 그림자
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2.5, 8, 3.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 25 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0xeedccc, 0.35));

  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 48), new THREE.ShadowMaterial({ opacity: 0.14 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  scene.add(floor);

  // 덩어리 = 비누 + 왁스 파편. 비스듬히 기울어 떠 있다.
  const lump = new THREE.Group();
  lump.position.y = LUMP_Y;
  lump.rotation.set(0.42, -0.35, -0.2);
  scene.add(lump);

  // 비누: 윗면에 글씨가 인쇄된 텍스처 (바탕은 클레이 색)
  await ensureFont(data.f, data.t);
  const tc = document.createElement('canvas');
  tc.width = 1024;
  tc.height = Math.round((1024 * LABEL.d) / LABEL.w);
  const lc = document.createElement('canvas');
  lc.width = tc.width;
  lc.height = tc.height;
  drawLabel(lc.getContext('2d'), lc.width, lc.height, data);
  const tctx = tc.getContext('2d');
  tctx.fillStyle = PALETTE.clay[data.c][0];
  tctx.fillRect(0, 0, tc.width, tc.height);
  tctx.drawImage(lc, 0, 0);
  const tex = new THREE.CanvasTexture(tc);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const soapGeo = soapGeometry();
  const soap = new THREE.Mesh(soapGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  soap.castShadow = soap.receiveShadow = true;
  lump.add(soap);
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
    mesh.castShadow = mesh.receiveShadow = true;
    const chunk = {
      ...c, mesh,
      state: INTACT,
      vel: new THREE.Vector3(), spin: new THREE.Vector3(),
      delay: 0, pending: false, onFloor: false, rest: null, restY: 0, still: 0,
    };
    mesh.userData.chunk = chunk;
    if (c.wall) {
      const wall = new THREE.Mesh(c.wall, waxMat);
      wall.userData.chunk = chunk;
      mesh.add(wall);
    }
    lump.add(mesh);
    return chunk;
  });

  // 화면 크기에 맞춰 카메라 거리 조정
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(2.6 / tanV, 2.2 / (tanV * camera.aspect));
    const dir = camera.position.lengthSq() > 0 ? camera.position.clone().sub(controls.target).normalize() : viewDir;
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    controls.minDistance = dist * 0.5;
    controls.maxDistance = dist * 1.6;
    controls.update();
  }
  controls.target.set(0, LUMP_Y - 0.3, 0);
  window.addEventListener('resize', resize);
  resize();

  // ---------- 입력 ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let finished = false;
  let presses = 0;
  let squash = 1; // 덩어리가 눌려 살짝 납작해지는 정도 (1 = 그대로)

  function pick(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const targets = [soap, ...chunks.filter((c) => c.state < FALLING).map((c) => c.mesh)];
    const hit = raycaster.intersectObjects(targets, true)[0];
    if (!hit) return null;
    return { point: hit.point.clone(), chunk: hit.object.userData.chunk ?? null };
  }

  function onDown(e) {
    sound.unlock();
    if (!e.isPrimary) {
      // 두 번째 손가락: 누르기를 취소하고 확대·축소는 OrbitControls에 맡긴다
      if (press) { clearTimeout(press.timer); press = null; controls.enabled = true; }
      return;
    }
    const hit = pick(e.clientX, e.clientY);
    if (hit) {
      // 다 깬 뒤에도 덩어리는 돌려 볼 수 있다 (누르기만 막는다)
      controls.enabled = false;
      const p = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), mode: 'press', fired: finished };
      // 손가락이 움직이지 않고 HOLD_MS 동안 누르고 있으면 '꾹'
      if (!finished) {
        p.timer = setTimeout(() => {
          if (press !== p || p.mode !== 'press') return;
          p.fired = true;
          longPress(p.x, p.y);
          squash = 0.955;
        }, HOLD_MS);
      }
      press = p;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 등 */ }
    } else {
      controls.enabled = true;
      press = null;
    }
  }

  function onMove(e) {
    if (!press || !e.isPrimary) return;
    if (press.mode === 'press' && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 9) press.mode = 'rotate';
    if (press.mode === 'rotate') rotateLump(e.clientX - press.lx, e.clientY - press.ly);
    press.lx = e.clientX;
    press.ly = e.clientY;
  }

  function onUp(e) {
    if (!e.isPrimary) return;
    if (press && press.mode === 'press' && !press.fired && e.type === 'pointerup') shortPress(press.x, press.y);
    if (press) clearTimeout(press.timer);
    press = null;
    controls.enabled = true;
  }

  // 덩어리를 손가락 방향대로 굴린다 (화면 기준)
  const axisUp = new THREE.Vector3(), axisRight = new THREE.Vector3(), q = new THREE.Quaternion();
  function rotateLump(dx, dy) {
    camera.matrixWorld.extractBasis(axisRight, axisUp, new THREE.Vector3());
    const s = 0.008;
    q.setFromAxisAngle(axisUp, dx * s);
    lump.quaternion.premultiply(q);
    q.setFromAxisAngle(axisRight, dy * s);
    lump.quaternion.premultiply(q);
  }

  // 그냥 누름: 금 간 파편이면 떨어지고, 아니면 톡 소리만
  function shortPress(x, y) {
    const hit = pick(x, y);
    if (hit) shortHit(hit.chunk, lump.worldToLocal(hit.point));
  }
  function shortHit(chunk, local) {
    if (chunk && chunk.state === CRACKED) {
      presses++;
      dropAround(chunk, local);
    } else {
      squash = Math.min(squash, 0.992);
      sound.tick();
    }
  }

  // 꾹 누름: 금 간 파편이면 떨어지고, 아니면 주변에 금이 간다
  function longPress(x, y) {
    const hit = pick(x, y);
    if (hit) longHit(hit.chunk, lump.worldToLocal(hit.point));
  }
  function longHit(chunk, local) {
    presses++;
    dent(local);
    if (chunk && chunk.state === CRACKED) {
      dropAround(chunk, local);
      return;
    }
    let n = 0;
    for (const c of chunks) {
      if (c.state !== INTACT) continue;
      if (c === chunk || c.center.distanceTo(local) < CRACK_R) { crack(c); n++; }
    }
    if (n) {
      sound.crack(n);
      navigator.vibrate?.(n > 4 ? [18, 30, 18] : 18);
    }
  }

  function dropAround(hitChunk, local) {
    let n = 0;
    for (const c of chunks) {
      if (c.state !== CRACKED) continue;
      if (c === hitChunk || c.center.distanceTo(local) < DROP_R) { fall(c); n++; }
    }
    sound.crack(Math.max(1, n / 2));
    navigator.vibrate?.(10);
    checkFinish();
  }

  function checkFinish() {
    const gone = chunks.filter((c) => c.state >= FALLING).length;
    if (!finished && gone / chunks.length >= FINISH_AT) {
      finished = true;
      setTimeout(finale, 300);
    }
  }

  // 누른 자리의 클레이가 살짝 들어간다 (돌아오지 않음)
  function dent(p) {
    const pos = soapGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(restPos[i * 3] - p.x, restPos[i * 3 + 1] - p.y, restPos[i * 3 + 2] - p.z);
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
  }

  // 금 가기: 들뜨고 비틀어져 틈이 보인다
  function crack(c) {
    c.state = CRACKED;
    c.mesh.position.copy(c.center).addScaledVector(c.normal, 0.03 + Math.random() * 0.025);
    c.mesh.rotation.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12);
  }

  // 떨어지기: 덩어리에서 떼어 내 바깥쪽으로 살짝 밀려나며 떨어진다
  function fall(c) {
    c.state = FALLING;
    scene.attach(c.mesh);
    const n = c.normal.clone().applyQuaternion(lump.quaternion);
    c.vel.copy(n).multiplyScalar(0.7 + Math.random() * 0.7);
    c.vel.x += (Math.random() - 0.5) * 0.6;
    c.vel.z += (Math.random() - 0.5) * 0.6;
    c.vel.y += Math.random() * 0.6;
    c.spin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 8);
  }

  // 바닥에 닿으면 납작하게 눕는다 (바깥면이 위로 오는 경우가 많게)
  function settleTarget(c) {
    const faceUp = Math.random() < 0.65 ? UP : UP.clone().negate();
    const target = new THREE.Quaternion().setFromUnitVectors(c.normal, faceUp);
    target.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2));
    const pos = c.body.attributes.position;
    const v = new THREE.Vector3();
    let minY = Infinity;
    for (let i = 0; i < pos.count; i += 3) minY = Math.min(minY, v.fromBufferAttribute(pos, i).applyQuaternion(target).y);
    c.rest = target;
    c.restY = FLOOR_Y - minY + Math.random() * 0.004;
  }

  // 떨어지는 파편이 덩어리를 뚫고 지나가지 않게 밀어낸다
  const half = new THREE.Vector3(OUTER.w / 2, OUTER.h / 2, OUTER.d / 2);
  const invQ = new THREE.Quaternion();
  const lp = new THREE.Vector3(), lv = new THREE.Vector3();
  function pushOutOfLump(c) {
    lp.copy(c.mesh.position);
    lump.worldToLocal(lp);
    const pen = [half.x - Math.abs(lp.x), half.y - Math.abs(lp.y), half.z - Math.abs(lp.z)];
    if (pen[0] <= 0 || pen[1] <= 0 || pen[2] <= 0) return;
    const axis = pen.indexOf(Math.min(...pen));
    const key = 'xyz'[axis];
    const sign = Math.sign(lp[key]) || 1;
    lp[key] = sign * half[key];
    c.mesh.position.copy(lump.localToWorld(lp));
    invQ.copy(lump.quaternion).invert();
    lv.copy(c.vel).applyQuaternion(invQ);
    if (lv[key] * sign < 0) lv[key] *= -0.3;
    c.vel.copy(lv.applyQuaternion(lump.quaternion));
  }

  function finale() {
    for (const c of chunks) {
      if (c.state >= FALLING) continue;
      if (c.state === INTACT) crack(c);
      c.pending = true;
      c.delay = Math.random() * 0.6;
    }
    sound.crack(6);
    sound.crack(4, 0.2);
    navigator.vibrate?.([20, 40, 20]);
    setTimeout(() => $('done').classList.add('show'), 1800);
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

  // ---------- 매 프레임 ----------
  const clock = new THREE.Clock();
  const spinQ = new THREE.Quaternion();
  const spinE = new THREE.Euler();
  function frame() {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const time = clock.elapsedTime;

    // 꾹 누르는 중: 점점 눌리다가 시간이 차면 깨진다
    let target = 1;
    if (press && press.mode === 'press' && !press.fired) {
      const k = Math.min(1, (performance.now() - press.t) / HOLD_MS);
      target = 1 - 0.03 * k;
    }
    squash += (target - squash) * (1 - Math.exp(-14 * dt));
    soap.scale.set(1 + (1 - squash) * 0.4, squash, 1 + (1 - squash) * 0.4);

    // 둥실 떠 있기
    lump.position.y = LUMP_Y + Math.sin(time * 1.1) * 0.04;
    lump.updateMatrixWorld();

    for (const c of chunks) {
      if (c.state !== FALLING) {
        if (c.pending) {
          c.delay -= dt;
          if (c.delay <= 0) { c.pending = false; fall(c); }
        }
        continue;
      }
      const m = c.mesh;
      if (c.onFloor) {
        m.position.x += c.vel.x * dt;
        m.position.z += c.vel.z * dt;
        c.vel.multiplyScalar(Math.exp(-6 * dt));
        const k = 1 - Math.exp(-12 * dt);
        m.quaternion.slerp(c.rest, k);
        m.position.y += (c.restY - m.position.y) * k;
        c.still += dt;
        if (c.still > 1.5) c.state = GONE; // 멈춤: 그대로 바닥에 둔다
        continue;
      }
      c.vel.y -= 9.8 * dt;
      m.position.addScaledVector(c.vel, dt);
      spinE.set(c.spin.x * dt, c.spin.y * dt, c.spin.z * dt);
      m.quaternion.multiply(spinQ.setFromEuler(spinE));
      pushOutOfLump(c);
      if (m.position.y < FLOOR_Y + 0.05 && c.vel.y < 0) {
        c.onFloor = true;
        c.vel.y = 0;
        c.vel.x *= 0.5;
        c.vel.z *= 0.5;
        settleTarget(c);
        sound.tick();
      }
    }

    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();
  $('loading').classList.add('gone');

  // 확인용: 개발자 도구에서 누른 횟수와 파편 상태를 볼 수 있다
  window.__wax = {
    get presses() { return presses; },
    get finished() { return finished; },
    chunks, camera, canvas, lump,
    // 파편 c 한가운데를 눌러 본다 (long: 꾹)
    pressChunk(c, long) {
      if (long) longHit(c, c.center.clone()); else shortHit(c, c.center.clone());
    },
    longPress, shortPress,
  };
}
