// 깨기 화면: 어두운 무대 위, 핀 조명 아래 왁스로 덮인 비누 덩어리가 앞뒤로만 비스듬히 떠 있다 (움직이지 않음).
// 왁스는 여러 겹일 수 있다 (겉 왁스 → 속 왁스 → 클레이).
// - 덩어리를 꾹 누르면: 누른 자리를 중심으로 거미줄 모양으로 금이 간다 (가운데는 부서져 바로 떨어짐)
// - 꾹 누른 채로 끌면: 지나가는 선을 따라 파사삭 연달아 부서진다
// - 금 간 왁스를 한 번 더 누르면: 그 파편들이 무대 바닥으로 떨어진다
// - 끌면(꾹 누르기 전에 움직이거나 바깥을 끌면) 카메라 시점만 돈다. 덩어리는 돌지 않는다.
// - 처음 화면을 만지면 팀파니 "두구두구… 둥!"이 울리고, 그때부터 화면과 소리를 녹화한다
// - 클레이 글씨가 95% 드러나면 환호와 함께 컨페티가 떨어지고, 아래에서 왁뿌 버튼
//   (다시 부수기 / 나도 만들기 / 영상 저장)이 올라온다. 꾹 누르면 왁스가 깨지며 눌린다.
// - 그 뒤로는 드러난 클레이를 잡아당기면 점토처럼 늘어나거나 눌린다
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PALETTE, LABEL } from './share.js';
import { drawLabel, ensureFont, onFontsLoaded } from './label.js';
import { soapGeometry, initialWaxPolys, webSeeds, splitPolys, buildPiece, waxBox } from './geometry.js';
import { buildStage } from './stage.js';
import { makeConfetti } from './confetti.js';
import * as sound from './sound.js';

// 깨지는 정도 (겹 하나 기준 20~30번 누르면 다 깨지도록 맞춘 값)
const WEB_R = 1.1; // 꾹 누른 자리에서 이 거리 안의 성한 조각이 거미줄 모양으로 다시 갈라진다
const CRUMB_R = 0.3; // 이 안쪽 조각은 바로 떨어진다
const DROP_R = 1.1; // 금 간 파편을 누르면 이 반경 안의 금 간 파편이 함께 떨어진다
const SCRUB_STEP = 0.32; // 꾹 누른 채 끌 때 이만큼 움직일 때마다 부순다
const SCRUB_R = 0.5; // 끌면서 부술 때 함께 떨어지는 반경
const FINISH_AT = 0.9; // 왁스 넓이의 이만큼이 떨어지면 남은 것도 다 떨어진다
const HOLD_MS = 420; // 이만큼 누르고 있으면 '꾹'

// 왁뿌 버튼: 크기(본 덩어리 대비), 자리 (덩어리보다 조금 아래, 카메라 쪽)
const BTN_SCALE = 0.36;
const BTN_Y = -1.15;
const BTN_Z = 2.0;
const BTN_GAP_X = 1.5; // 버튼 사이 간격 (세 개일 때)
const REVEAL_AT = 0.95; // 클레이 글씨 획의 이만큼이 드러나면 버튼이 올라온다

const LUMP_Y = 0.35; // 덩어리가 떠 있는 높이
const FLOOR_Y = -1.9;
const TILT = 0.78; // 앞쪽으로 기운 각도 (좌우는 평평). 가파를수록 윗면 글씨가 카메라를 향해 조명 반사가 덜하다

const INTACT = 0, CRACKED = 1, FALLING = 2, GONE = 3;
const UP = new THREE.Vector3(0, 1, 0);

export async function startPlay(data) {
  const $ = (id) => document.getElementById(id);
  const canvas = $('scene');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1); // 해상도는 resize()에서 직접 정한다 (녹화용으로 짝수 크기·상한)
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
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
  // 위·아래·뒤 어디서든 볼 수 있다 (바로 위/아래 끝만 피한다)
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI - 0.05;
  controls.rotateSpeed = 0.7;

  const stage = buildStage(scene, { floorY: FLOOR_Y, targetY: LUMP_Y });

  // 덩어리 = 비누 + 왁스 겹들
  const lump = new THREE.Group();
  lump.position.y = LUMP_Y;
  lump.rotation.x = TILT;
  scene.add(lump);

  const layers = data.layers; // 바깥부터
  // 쓰는 글자(버튼 글씨 포함)가 든 글꼴 묶음을 모두 받을 때까지 기다린다 (로딩 화면이 가려 준다)
  await ensureFont(data.f, data.t + layers.map((l) => l.o || '').join('') + '다시 부수기나도 만들기영상 저장', 10000);
  const textures = [];
  onFontsLoaded(() => textures.forEach((t) => t.redraw()));
  // 바탕색 + 인쇄된 글씨 텍스처. ink: 글씨만 그린 캔버스 (글씨가 얼마나 드러났는지 재는 데 씀)
  const makeTex = (bg, text, labelOpts, k = data.k) => {
    const tc = document.createElement('canvas');
    tc.width = 1024;
    tc.height = Math.round((1024 * LABEL.d) / LABEL.w);
    const ctx = tc.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, tc.width, tc.height);
    const lc = document.createElement('canvas');
    lc.width = tc.width;
    lc.height = tc.height;
    const draw = () => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, tc.width, tc.height);
      if (text && text.trim()) {
        drawLabel(lc.getContext('2d'), lc.width, lc.height, { ...data, t: text, k }, labelOpts);
        ctx.drawImage(lc, 0, 0);
      }
    };
    draw();
    const tex = new THREE.CanvasTexture(tc);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    textures.push({ redraw: () => { draw(); tex.needsUpdate = true; } });
    return { tex, ink: lc };
  };
  const waxMaterial = (color, text, labelOpts, k) => new THREE.MeshPhysicalMaterial({
    map: makeTex(color, text, labelOpts, k).tex,
    vertexColors: true,
    roughness: 0.5,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
    envMapIntensity: ENV,
    side: THREE.DoubleSide,
  });

  // 클레이
  const clayColor = PALETTE.clay[data.c][0];
  const clayTex = makeTex(clayColor, data.t);
  const soap = new THREE.Mesh(
    soapGeometry(),
    new THREE.MeshStandardMaterial({ map: clayTex.tex, roughness: 0.78, envMapIntensity: ENV }),
  );
  soap.castShadow = soap.receiveShadow = true;
  lump.add(soap);

  // 왁스 겹마다 상자 크기와 재질. j = 안쪽부터 센 번호
  const waxLayers = layers.map((_, j) => {
    const l = layers[layers.length - 1 - j];
    return {
      box: waxBox(j),
      mat: waxMaterial(PALETTE.wax[l.w][0], l.o, undefined, l.k),
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
    markCover(chunk);
    return chunk;
  }

  // 클레이 글씨가 얼마나 드러났는지: 글씨 획 위에만 점을 촘촘히 찍고, 점마다 그 위를 덮은 겹별 조각을 기억한다
  const SAMPLES = [];
  {
    const W = clayTex.ink.width, H = clayTex.ink.height;
    const px = clayTex.ink.getContext('2d').getImageData(0, 0, W, H).data;
    const NX = 72, NY = Math.round((72 * H) / W);
    for (let i = 0; i < NX; i++) {
      for (let k = 0; k < NY; k++) {
        const x = Math.floor(((i + 0.5) / NX) * W), y = Math.floor(((k + 0.5) / NY) * H);
        if (px[(y * W + x) * 4 + 3] > 80) SAMPLES.push([(x / W - 0.5) * LABEL.w, (y / H - 0.5) * LABEL.d]);
      }
    }
    if (!SAMPLES.length) SAMPLES.push([0, 0]);
  }
  const cover = layers.map(() => new Array(SAMPLES.length).fill(null)); // cover[겹][점] = 그 점을 덮은 조각
  function markCover(chunk) {
    const top = waxLayers[chunk.layer].box.h / 2;
    for (const { p } of chunk.polys) {
      if (p.reduce((s, q) => s + q[1], 0) / p.length < top - 0.05) continue; // 윗면 다각형만
      SAMPLES.forEach(([x, z], si) => {
        let sign = 0;
        for (let a = 0; a < p.length; a++) {
          const A = p[a], B = p[(a + 1) % p.length];
          const cr = (B[0] - A[0]) * (z - A[2]) - (B[2] - A[2]) * (x - A[0]);
          if (Math.abs(cr) < 1e-9) continue;
          if (sign === 0) sign = Math.sign(cr);
          else if (Math.sign(cr) !== sign) return;
        }
        cover[chunk.layer][si] = chunk;
      });
    }
  }
  let revealed = false;
  function checkReveal() {
    if (revealed) return;
    const open = SAMPLES.filter((_, si) => cover.every((row) => !row[si] || row[si].state >= FALLING)).length;
    if (open / SAMPLES.length >= REVEAL_AT) {
      revealed = true;
      setTimeout(celebrate, 400);
    }
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

  // 영상 녹화 상태 (resize에서도 보므로 먼저 만든다)
  let recorder = null;
  const recChunks = [];

  // 화면 크기에 맞춰 카메라 거리와 커튼 위치 조정
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // 녹화 중에는 그림 크기를 바꾸지 않는다 (영상 중간에 크기가 바뀌면 맥 등에서 화면이 안 나온다)
    if (recorder && recorder.state !== 'inactive') return;
    // 그림 크기: 화면 × 기기 배율, 긴 쪽 최대 1920, 가로세로 짝수 (H.264 영상 규칙)
    const scale = Math.min(window.devicePixelRatio || 1, 2, 1920 / Math.max(w, h));
    const even = (v) => Math.max(2, Math.round((v * scale) / 2) * 2);
    renderer.setSize(even(w), even(h), false);
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

  function pick(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const targets = [soap, ...chunks.filter((c) => c.state < FALLING).map((c) => c.mesh)];
    for (const b of buttons) if (b.group.visible) targets.push(...b.group.children);
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    if (hit.object.userData.button) return { button: hit.object.userData.button };
    return { local: lump.worldToLocal(hit.point.clone()), world: hit.point.clone(), chunk: hit.object.userData.chunk ?? null };
  }

  let started = false;
  function onDown(e) {
    sound.unlock();
    if (!started) {
      started = true;
      sound.drumroll();
      startRecording();
    }
    if (!e.isPrimary) {
      // 두 번째 손가락: 누르기를 취소하고 확대·축소는 OrbitControls에 맡긴다
      if (press) { clearTimeout(press.timer); press = null; controls.enabled = true; }
      return;
    }
    const hit = pick(e.clientX, e.clientY);
    if (hit && revealed && !hit.button && !hit.chunk) {
      // 글씨가 드러난 뒤: 클레이를 잡아당긴다
      controls.enabled = false;
      press = { mode: 'grab', x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY };
      startGrab(hit.world, e.clientX, e.clientY);
      try { canvas.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 등 */ }
      return;
    }
    if (hit && (hit.button || !finished)) {
      controls.enabled = false;
      const p = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), mode: 'press', fired: false };
      p.timer = setTimeout(() => {
        if (press !== p || p.mode !== 'press') return;
        p.fired = true;
        p.mode = 'scrub';
        const h = pick(p.lx, p.ly);
        if (h?.button) { pressButton(h.button); p.mode = 'done'; }
        else if (h && !finished) { longHit(h.chunk, h.local); p.last = h.local; }
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
    if (press.mode === 'grab') moveGrab(e.clientX, e.clientY);
    press.lx = e.clientX;
    press.ly = e.clientY;
  }

  function onUp(e) {
    if (!e.isPrimary) return;
    if (press && press.mode === 'press' && !press.fired && e.type === 'pointerup') shortPress(press.x, press.y);
    if (press?.mode === 'grab') grab = null;
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
    if (!h || h.button) return;
    if (press.last && press.last.distanceTo(h.local) < SCRUB_STEP) return;
    press.last = h.local;
    if (h.chunk && h.chunk.state === CRACKED) {
      dropAround(h.chunk, h.local, SCRUB_R, true);
    } else if (h.chunk) {
      shatter(h.local, h.chunk.layer, 0.75, SCRUB_R, true);
    }
  }

  // 그냥 누름: 금 간 파편이면 떨어지고, 성한 왁스(겉·속 모두)는 깨지지 않는다
  function shortPress(x, y) {
    const h = pick(x, y);
    if (h?.button) sound.tick();
    else if (h) shortHit(h.chunk, h.local);
  }
  function shortHit(chunk, local) {
    if (chunk && chunk.state === CRACKED) {
      presses++;
      dropAround(chunk, local, DROP_R);
    } else {
      sound.tick();
    }
  }

  // 꾹 누름: 금 간 파편이면 떨어지고, 성한 왁스면 거미줄 모양으로 금이 간다 (클레이는 그대로)
  function longHit(chunk, local) {
    if (!chunk) return;
    presses++;
    if (chunk.state === CRACKED) { dropAround(chunk, local, DROP_R); return; }
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
    checkReveal();
    const gone = chunks.filter((c) => c.state >= FALLING).reduce((s, c) => s + c.area, 0);
    if (!finished && gone / totalArea >= FINISH_AT) {
      finished = true;
      setTimeout(finale, 300);
    }
  }

  // 떨어지기: 덩어리에서 떼어 내 바깥쪽으로 살짝 밀려나며 떨어진다
  function fall(c, push = 1) {
    c.state = FALLING;
    const n = c.normal.clone().applyQuaternion(c.mesh.parent.getWorldQuaternion(new THREE.Quaternion()));
    scene.attach(c.mesh);
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
    c.restY = FLOOR_Y - minY * c.mesh.scale.y + Math.random() * 0.004;
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
  }

  // ---------- 왁뿌 버튼 ----------
  // 맨 속 왁스 겹으로 코팅된 작은 비누. 안쪽 클레이 색은 본 덩어리와 같고, 왁스 겉면에 버튼 글씨.
  const buttons = [];
  const btnPieces = [];
  {
    // 버튼은 맨 속 왁스 겹과 같은 왁스 색·글씨 색
    const innerLayer = layers[layers.length - 1];
    const innerWax = PALETTE.wax[innerLayer.w][0];
    const clayMat = new THREE.MeshStandardMaterial({ map: makeTex(clayColor, '').tex, roughness: 0.78, envMapIntensity: ENV });
    const box = waxBox(0);
    const defs = [
      ['다시 부수기', () => location.reload()],
      ['나도 만들기', () => (location.href = location.pathname)],
    ];
    if (canRecord()) defs.push(['영상 저장', () => saveVideo()]);
    // 버튼 글씨는 모두 같은 크기, 가장 긴 글씨가 버튼 윗면을 거의 채우도록
    const labelOpts = { fitTexts: defs.map((d) => d[0]), pad: 0.02, maxH: 0.9 };
    defs.forEach(([label, action], i) => {
      const x = (i - (defs.length - 1) / 2) * (defs.length === 2 ? BTN_GAP_X * 0.62 : BTN_GAP_X);
      const group = new THREE.Group();
      group.scale.setScalar(BTN_SCALE);
      group.rotation.x = TILT;
      group.position.set(x, FLOOR_Y - 1.2, BTN_Z);
      group.visible = false;
      scene.add(group);
      const btn = { group, action, pressed: false, rise: -1, delay: 0, from: FLOOR_Y - 1.2 };
      const clay = new THREE.Mesh(soapGeometry(), clayMat);
      clay.castShadow = clay.receiveShadow = true;
      clay.userData.button = btn;
      group.add(clay);
      const mat = waxMaterial(innerWax, label, labelOpts, innerLayer.k);
      btn.pieces = initialWaxPolys(box, 10).map((polys) => {
        const piece = buildPiece(polys, box);
        const mesh = new THREE.Mesh(piece.body, mat);
        mesh.position.copy(piece.center);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.button = btn;
        group.add(mesh);
        return { ...piece, mesh, state: INTACT, vel: new THREE.Vector3(), spin: new THREE.Vector3(), onFloor: false, rest: null, restY: 0, still: 0 };
      });
      buttons.push(btn);
    });
  }
  function showButtons() {
    for (const b of buttons) { b.group.visible = true; b.rise = 0; }
  }

  // 글씨가 드러났을 때: 휘파람·환호·컨페티, 그리고 버튼이 올라온다
  function celebrate() {
    sound.stopRoll();
    sound.cheer(0.15);
    confetti.start();
    setTimeout(showButtons, 600);
  }

  // ---------- 컨페티 ----------
  const confetti = makeConfetti(scene, FLOOR_Y);

  // ---------- 영상 녹화 ----------
  function canRecord() {
    return !!(window.MediaRecorder && canvas.captureStream);
  }
  function startRecording() {
    if (recorder || !canRecord()) return;
    try {
      const stream = canvas.captureStream(30);
      const audio = sound.audioTrack();
      if (audio) stream.addTrack(audio);
      // 맥(QuickTime)·아이폰에서 바로 재생되는 H.264(avc1) mp4를 먼저. avc3는 QuickTime이 화면을 못 읽는다.
      const types = [
        'video/mp4;codecs=avc1.640028,mp4a.40.2',
        'video/mp4;codecs=avc1.4d0028,mp4a.40.2',
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm',
      ];
      const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
      recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
      recorder.start(1000);
    } catch {
      recorder = null;
    }
  }
  function saveVideo() {
    if (!recorder || recorder.state === 'inactive') return;
    recorder.onstop = () => {
      const type = recorder.mimeType || 'video/webm';
      const blob = new Blob(recChunks, { type });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `메세지-왁뿌.${type.includes('mp4') ? 'mp4' : 'webm'}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    };
    recorder.stop();
  }

  // ---------- 클레이 잡아당기기 (글씨가 드러난 뒤) ----------
  // 잡은 자리 근처 꼭짓점이 손가락을 따라 움직인다. 놓아도 그 모양 그대로 남는다 (점토처럼).
  const GRAB_R = 1.0;
  const GRAB_GAIN = 0.4;
  const soapPos = soap.geometry.attributes.position;
  let grab = null;
  const grabPlane = new THREE.Plane();
  const grabHit = new THREE.Vector3();
  function startGrab(worldPoint, x, y) {
    const local = lump.worldToLocal(worldPoint.clone());
    const weights = new Float32Array(soapPos.count);
    for (let i = 0; i < soapPos.count; i++) {
      const d = Math.hypot(soapPos.getX(i) - local.x, soapPos.getY(i) - local.y, soapPos.getZ(i) - local.z);
      weights[i] = d < GRAB_R ? (1 - (d / GRAB_R) ** 2) ** 2 : 0;
    }
    grabPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), worldPoint);
    grab = { start: worldPoint.clone(), base: soapPos.array.slice(), weights };
  }
  function moveGrab(x, y) {
    if (!grab) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(grabPlane, grabHit)) return;
    // 감도: 손가락이 움직인 거리의 GRAB_GAIN배만큼만 늘어난다
    const delta = grabHit.clone().sub(grab.start).multiplyScalar(GRAB_GAIN);
    if (delta.length() > 0.9) delta.setLength(0.9);
    delta.applyQuaternion(lump.quaternion.clone().invert()); // 덩어리 기준 방향으로
    const a = soapPos.array;
    for (let i = 0; i < soapPos.count; i++) {
      const w = grab.weights[i];
      if (!w) continue;
      a[i * 3] = grab.base[i * 3] + delta.x * w;
      a[i * 3 + 1] = grab.base[i * 3 + 1] + delta.y * w;
      a[i * 3 + 2] = grab.base[i * 3 + 2] + delta.z * w;
    }
    soapPos.needsUpdate = true;
    soap.geometry.computeVertexNormals();
    soap.geometry.computeBoundingSphere();
  }
  // 꾹 누르면 왁스가 깨져 떨어지고, 잠시 뒤 버튼 동작
  function pressButton(btn) {
    if (btn.pressed || btn.rise < 1) return;
    btn.pressed = true;
    for (const c of btn.pieces) {
      fall(c, 1.2);
      btnPieces.push(c);
    }
    sound.crack(5);
    navigator.vibrate?.([18, 30, 18]);
    setTimeout(btn.action, 900);
  }

  // ---------- 매 프레임 ----------
  const clock = new THREE.Clock();
  const spinQ = new THREE.Quaternion();
  const spinE = new THREE.Euler();
  function frame() {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const time = clock.elapsedTime;

    // 버튼이 아래에서 올라온다
    for (const b of buttons) {
      if (b.rise < 0 || b.rise >= 1) continue;
      if (b.delay > 0) { b.delay -= dt; continue; }
      b.rise = Math.min(1, b.rise + dt / 1.1);
      const e = 1 - (1 - b.rise) ** 3;
      b.group.position.y = b.from + (BTN_Y - b.from) * e;
    }

    for (const c of [...chunks, ...btnPieces]) {
      if (c.state !== FALLING) {
        if (c.pending) {
          c.delay -= dt;
          if (c.delay <= 0) { c.pending = false; fall(c); checkReveal(); }
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
      if (c.layer !== undefined) pushOutOfLump(c);
      if (m.position.y < FLOOR_Y + 0.05 && c.vel.y < 0) {
        c.onFloor = true;
        c.vel.y = 0;
        c.vel.x *= 0.5;
        c.vel.z *= 0.5;
        settleTarget(c);
        sound.tick();
      }
    }

    confetti.update(dt);
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
    camera, canvas, lump, buttons, pressButton,
    get revealed() { return revealed; },
    // 파편 c 한가운데를 눌러 본다 (long: 꾹)
    pressChunk(c, long) {
      if (long) longHit(c, c.center.clone()); else shortHit(c, c.center.clone());
    },
  };
}
