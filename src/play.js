// 깨기 화면: 어두운 무대 위, 핀 조명 아래 왁스로 덮인 비누 덩어리가 앞뒤로만 비스듬히 떠 있다.
// 왁스는 여러 겹일 수 있다 (겉 왁스 → 속 왁스 → 클레이).
// - 덩어리를 꾹 누르면: 누른 자리를 중심으로 거미줄 모양으로 금이 간다 (가운데는 부서져 바로 떨어짐)
// - 꾹 누른 채로 끌면: 지나가는 선을 따라 파사삭 연달아 부서진다
// - 금 간 왁스를 한 번 더 누르면: 그 파편들이 무대 바닥으로 떨어진다
// - 겉 왁스가 떨어져 드러난 속 왁스는 톡 누르기만 해도 부서진다
// - 끌면(꾹 누르기 전에 움직이거나 바깥을 끌면) 카메라 시점만 돈다. 덩어리는 돌지 않는다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PALETTE, LABEL } from './share.js';
import { drawLabel, ensureFont } from './label.js';
import { soapGeometry, initialWaxPolys, webSeeds, splitPolys, buildPiece, waxBox } from './geometry.js';
import { buildStage } from './stage.js';
import * as sound from './sound.js';

// 깨지는 정도 (겹 하나 기준 20~30번 누르면 다 깨지도록 맞춘 값)
const WEB_R = 1.1; // 꾹 누른 자리에서 이 거리 안의 성한 조각이 거미줄 모양으로 다시 갈라진다
const CRUMB_R = 0.3; // 이 안쪽 조각은 바로 떨어진다
const DROP_R = 1.1; // 금 간 파편을 누르면 이 반경 안의 금 간 파편이 함께 떨어진다
const SCRUB_STEP = 0.32; // 꾹 누른 채 끌 때 이만큼 움직일 때마다 부순다
const SCRUB_R = 0.5; // 끌면서 부술 때 함께 떨어지는 반경
const FINISH_AT = 0.9; // 왁스 넓이의 이만큼이 떨어지면 남은 것도 다 떨어진다
const HOLD_MS = 420; // 이만큼 누르고 있으면 '꾹'

// 클레이 눌림 (클수록 말랑한 클레이)
const DENT_R = 0.62;
const DENT_DEPTH = 0.06;
const DENT_MAX = 0.16;

const LUMP_Y = 0.35; // 덩어리가 떠 있는 높이
const FLOOR_Y = -1.9;
const TILT = 0.5; // 앞쪽으로 기운 각도 (좌우는 평평)

const INTACT = 0, CRACKED = 1, FALLING = 2, GONE = 3;
const UP = new THREE.Vector3(0, 1, 0);

export async function startPlay(data) {
  const $ = (id) => document.getElementById(id);
  const canvas = $('scene');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0a0b);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  const ENV = 0.3; // 주변 반사는 약하게 (무대 조명 느낌)

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const viewDir = new THREE.Vector3(0, 0.42, 0.91).normalize();

  // 누르기·끌기 입력은 OrbitControls보다 먼저 받아야 해서 컨트롤을 만들기 전에 등록한다
  let press = null;
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.5;
  controls.minAzimuthAngle = -0.8;
  controls.maxAzimuthAngle = 0.8;
  controls.rotateSpeed = 0.7;

  const stage = buildStage(scene, { floorY: FLOOR_Y, targetY: LUMP_Y });

  // 덩어리 = 비누 + 왁스 겹들
  const lump = new THREE.Group();
  lump.position.y = LUMP_Y;
  lump.rotation.x = TILT;
  scene.add(lump);

  const layers = data.layers; // 바깥부터
  await ensureFont(data.f, data.t + layers.map((l) => l.o || '').join(''));
  const makeTex = (bg, text) => {
    const tc = document.createElement('canvas');
    tc.width = 1024;
    tc.height = Math.round((1024 * LABEL.d) / LABEL.w);
    const ctx = tc.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, tc.width, tc.height);
    if (text && text.trim()) {
      const lc = document.createElement('canvas');
      lc.width = tc.width;
      lc.height = tc.height;
      drawLabel(lc.getContext('2d'), lc.width, lc.height, { ...data, t: text });
      ctx.drawImage(lc, 0, 0);
    }
    const tex = new THREE.CanvasTexture(tc);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  };

  // 클레이
  const soapGeo = soapGeometry();
  const soap = new THREE.Mesh(
    soapGeo,
    new THREE.MeshStandardMaterial({ map: makeTex(PALETTE.clay[data.c][0], data.t), roughness: 0.78, envMapIntensity: ENV }),
  );
  soap.castShadow = soap.receiveShadow = true;
  lump.add(soap);
  const restPos = soapGeo.attributes.position.array.slice();
  const restNrm = soapGeo.attributes.normal.array.slice();
  const dents = new Float32Array(soapGeo.attributes.position.count);

  // 왁스 겹마다 상자 크기와 재질. j = 안쪽부터 센 번호
  const waxLayers = layers.map((_, j) => {
    const l = layers[layers.length - 1 - j];
    return {
      box: waxBox(j),
      mat: new THREE.MeshPhysicalMaterial({
        map: makeTex(PALETTE.wax[l.w][0], l.o),
        vertexColors: true,
        roughness: 0.38,
        clearcoat: 0.5,
        clearcoatRoughness: 0.35,
        envMapIntensity: ENV,
        side: THREE.DoubleSide,
      }),
    };
  });
  const outerBox = waxLayers[waxLayers.length - 1].box;

  // 왁스 파편들
  let chunks = [];
  function addPiece(piece, layer, state = INTACT) {
    const mesh = new THREE.Mesh(piece.body, waxLayers[layer].mat);
    mesh.position.copy(piece.center);
    mesh.castShadow = mesh.receiveShadow = true;
    const chunk = {
      ...piece, mesh, state, layer,
      vel: new THREE.Vector3(), spin: new THREE.Vector3(),
      delay: 0, pending: false, onFloor: false, rest: null, restY: 0, still: 0,
    };
    mesh.userData.chunk = chunk;
    lump.add(mesh);
    chunks.push(chunk);
    return chunk;
  }
  function removePiece(c) {
    lump.remove(c.mesh);
    c.body.dispose();
    chunks = chunks.filter((x) => x !== c);
  }
  waxLayers.forEach((wl, j) => {
    for (const polys of initialWaxPolys(wl.box, 30)) addPiece(buildPiece(polys, wl.box), j);
  });
  const totalArea = chunks.reduce((s, c) => s + c.area, 0);

  // 화면 크기에 맞춰 카메라 거리와 커튼 위치 조정
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(4.4 / tanV, 3.2 / (tanV * camera.aspect));
    const dir = camera.position.lengthSq() > 0 ? camera.position.clone().sub(controls.target).normalize() : viewDir;
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    controls.minDistance = dist * 0.5;
    controls.maxDistance = dist * 1.2;
    controls.update();
    stage.fit(tanV * camera.aspect * (dist + 1));
  }
  controls.target.set(0, LUMP_Y - 0.4, 0);
  window.addEventListener('resize', resize);
  resize();

  // ---------- 입력 ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let finished = false;
  let presses = 0;
  // 클레이가 눌렸다 출렁이며 돌아오는 정도 (스프링)
  let squash = 1, squashV = 0, squashTarget = 1;

  function pick(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const targets = [soap, ...chunks.filter((c) => c.state < FALLING).map((c) => c.mesh)];
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    return { local: lump.worldToLocal(hit.point.clone()), chunk: hit.object.userData.chunk ?? null };
  }

  function onDown(e) {
    sound.unlock();
    if (!e.isPrimary) {
      // 두 번째 손가락: 누르기를 취소하고 확대·축소는 OrbitControls에 맡긴다
      if (press) { clearTimeout(press.timer); press = null; controls.enabled = true; }
      return;
    }
    const hit = pick(e.clientX, e.clientY);
    if (hit && !finished) {
      controls.enabled = false;
      const p = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), mode: 'press', fired: false };
      p.timer = setTimeout(() => {
        if (press !== p || p.mode !== 'press') return;
        p.fired = true;
        p.mode = 'scrub';
        const h = pick(p.lx, p.ly);
        if (h) { longHit(h.chunk, h.local); p.last = h.local; }
      }, HOLD_MS);
      press = p;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 등 */ }
    } else {
      controls.enabled = true;
      press = null;
    }
  }

  function onMove(e) {
    if (!press || !e.isPrimary) return;
    if (press.mode === 'press' && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 9) {
      // 꾹 누르기 전에 움직임 → 시점 돌리기
      press.mode = 'orbit';
      clearTimeout(press.timer);
    }
    if (press.mode === 'orbit') orbit(e.clientX - press.lx, e.clientY - press.ly);
    if (press.mode === 'scrub') scrub(e.clientX, e.clientY);
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

  // 덩어리 위에서 시작한 끌기로도 시점이 돌도록 (OrbitControls와 같은 방식·제한)
  const sph = new THREE.Spherical();
  const offset = new THREE.Vector3();
  function orbit(dx, dy) {
    const k = (2 * Math.PI * controls.rotateSpeed) / canvas.clientHeight;
    offset.copy(camera.position).sub(controls.target);
    sph.setFromVector3(offset);
    sph.theta = THREE.MathUtils.clamp(sph.theta - dx * k, controls.minAzimuthAngle, controls.maxAzimuthAngle);
    sph.phi = THREE.MathUtils.clamp(sph.phi - dy * k, controls.minPolarAngle, controls.maxPolarAngle);
    offset.setFromSpherical(sph);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
  }

  // 꾹 누른 채 끌기: 일정 거리마다 그 자리를 부순다
  function scrub(x, y) {
    if (finished) return;
    const h = pick(x, y);
    if (!h) return;
    if (press.last && press.last.distanceTo(h.local) < SCRUB_STEP) return;
    press.last = h.local;
    if (h.chunk && h.chunk.state === CRACKED) {
      dropAround(h.chunk, h.local, SCRUB_R, true);
    } else if (h.chunk) {
      shatter(h.local, h.chunk.layer, 0.75, SCRUB_R, true);
    } else {
      dent(h.local, 0.5);
      squashV -= 0.4;
    }
  }

  // 그냥 누름: 금 간 파편이면 떨어지고, 아니면 말랑하게 살짝 눌렸다 돌아온다
  function shortPress(x, y) {
    const h = pick(x, y);
    if (h) shortHit(h.chunk, h.local);
  }
  function shortHit(chunk, local) {
    if (chunk && chunk.state === CRACKED) {
      presses++;
      dropAround(chunk, local, DROP_R);
    } else if (chunk && chunk.layer < waxLayers.length - 1) {
      // 겉 왁스가 떨어져 드러난 속 왁스는 톡 눌러도 부서진다
      presses++;
      if (chunk.layer === 0) dent(local, 0.6);
      shatter(local, chunk.layer, 1, CRUMB_R);
    } else {
      squashV -= 0.25;
      sound.tick();
    }
  }

  // 꾹 누름: 금 간 파편이면 떨어지고, 성한 왁스면 거미줄 모양으로 금이 간다, 클레이면 눌린다
  function longHit(chunk, local) {
    presses++;
    squashV -= 0.9;
    if (!chunk) { dent(local); return; }
    if (chunk.state === CRACKED) { dropAround(chunk, local, DROP_R); return; }
    if (chunk.layer === 0) dent(local);
    shatter(local, chunk.layer, 1, CRUMB_R);
  }

  // 누른 자리 근처의 같은 겹 성한 조각들을 거미줄 모양으로 다시 자른다
  function shatter(P, layer, scale, crumbR, quiet = false) {
    const box = waxLayers[layer].box;
    const seeds = webSeeds([P.x, P.y, P.z], box, scale);
    const affected = chunks.filter((c) => c.layer === layer && c.state === INTACT && c.center.distanceTo(P) < WEB_R * scale);
    if (!affected.length) return;
    let crumbs = 0;
    for (const old of affected) {
      removePiece(old);
      for (const polys of splitPolys(old.polys, seeds)) {
        if (!polys.length) continue;
        const piece = buildPiece(polys, box);
        const c = addPiece(piece, layer, CRACKED);
        const d = piece.center.distanceTo(P);
        if (d < crumbR) {
          fall(c, 0.6);
          crumbs++;
        } else {
          // 가까울수록 더 들뜨고 비틀어진다 → 거미줄 금이 보인다
          const k = Math.exp(-d / 0.6);
          c.mesh.position.copy(c.center).addScaledVector(c.normal, 0.01 + 0.035 * k + Math.random() * 0.006);
          const tw = 0.02 + 0.1 * k;
          c.mesh.rotation.set((Math.random() - 0.5) * tw, (Math.random() - 0.5) * tw, (Math.random() - 0.5) * tw);
        }
      }
    }
    sound.crack(quiet ? 1 + crumbs : 4 + crumbs);
    navigator.vibrate?.(quiet ? 8 : [18, 30, 18]);
    checkFinish();
  }

  function dropAround(hitChunk, local, radius, quiet = false) {
    let n = 0;
    for (const c of chunks) {
      if (c.state !== CRACKED) continue;
      if (c === hitChunk || c.center.distanceTo(local) < radius) { fall(c); n++; }
    }
    sound.crack(quiet ? 1 : Math.max(1, n / 2));
    navigator.vibrate?.(quiet ? 6 : 10);
    checkFinish();
  }

  function checkFinish() {
    const gone = chunks.filter((c) => c.state >= FALLING).reduce((s, c) => s + c.area, 0);
    if (!finished && gone / totalArea >= FINISH_AT) {
      finished = true;
      setTimeout(finale, 300);
    }
  }

  // 누른 자리의 클레이가 들어간다 (말랑해서 꽤 들어가고, 돌아오지 않음)
  function dent(p, amount = 1) {
    const pos = soapGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(restPos[i * 3] - p.x, restPos[i * 3 + 1] - p.y, restPos[i * 3 + 2] - p.z);
      if (d >= DENT_R) continue;
      const f = (1 - (d / DENT_R) ** 2) ** 2;
      dents[i] = Math.min(DENT_MAX, dents[i] + DENT_DEPTH * f * amount);
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

  // 떨어지기: 덩어리에서 떼어 내 바깥쪽으로 살짝 밀려나며 떨어진다
  function fall(c, push = 1) {
    c.state = FALLING;
    scene.attach(c.mesh);
    const n = c.normal.clone().applyQuaternion(lump.quaternion);
    c.vel.copy(n).multiplyScalar((0.7 + Math.random() * 0.7) * push);
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
  const half = new THREE.Vector3(outerBox.w / 2, outerBox.h / 2, outerBox.d / 2);
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
      c.state = CRACKED;
      c.pending = true;
      c.delay = Math.random() * 0.6 + (waxLayers.length - 1 - c.layer) * 0.15; // 바깥 겹부터
    }
    sound.crack(6);
    sound.crack(4, 0.2);
    navigator.vibrate?.([20, 40, 20]);
    setTimeout(() => $('done').classList.add('show'), 1900);
  }

  // 버튼
  $('again').addEventListener('click', () => location.reload());
  $('make').addEventListener('click', () => (location.href = location.pathname));

  // ---------- 매 프레임 ----------
  const clock = new THREE.Clock();
  const spinQ = new THREE.Quaternion();
  const spinE = new THREE.Euler();
  function frame() {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const time = clock.elapsedTime;

    // 꾹 누르는 동안 점점 눌린다. 놓거나 깨지면 출렁이며 돌아온다 (말랑한 클레이)
    squashTarget = 1;
    if (press && press.mode === 'press' && !press.fired) {
      squashTarget = 1 - 0.07 * Math.min(1, (performance.now() - press.t) / HOLD_MS);
    }
    squashV += ((squashTarget - squash) * 260 - squashV * 12) * dt;
    squash += squashV * dt;
    const bulge = 1 + (1 - squash) * 0.5;
    soap.scale.set(bulge, squash, bulge);

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
        if (c.still > 1.5) { c.state = GONE; m.castShadow = false; } // 멈춤: 그대로 바닥에 둔다 (그림자 계산 생략)
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

    stage.update(time, camera);
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
    get chunks() { return chunks; },
    camera, canvas, lump,
    // 파편 c 한가운데를 눌러 본다 (long: 꾹)
    pressChunk(c, long) {
      if (long) longHit(c, c.center.clone()); else shortHit(c, c.center.clone());
    },
  };
}
