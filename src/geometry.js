// 둥근 비누 모양과 왁스 껍질 조각내기.
// 왁스 껍질은 처음엔 큼직한 조각 몇십 개로만 나뉘어 있다(틈 없이 붙어 있어 안 보임).
// 꾹 누르면 그 자리를 중심으로 거미줄 모양 씨앗을 뿌려 주변 조각을 다시 자른다:
// 가운데는 잘게, 멀어질수록 크게.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SOAP, LABEL } from './share.js';

// 왁스: 비누 표면에서 gap만큼 떨어져 두께 t로 덮는다
export const WAX = { gap: 0.015, t: 0.1 };
const grow = WAX.gap + WAX.t;
export const OUTER = { w: SOAP.w + 2 * grow, h: SOAP.h + 2 * grow, d: SOAP.d + 2 * grow, r: SOAP.r + grow };

const clamp = (v, m) => Math.max(-m, Math.min(m, v));

// 둥근 상자 표면 위 점의 바깥 방향
export function roundNormal(p, box = OUTER) {
  const nx = p[0] - clamp(p[0], box.w / 2 - box.r);
  const ny = p[1] - clamp(p[1], box.h / 2 - box.r);
  const nz = p[2] - clamp(p[2], box.d / 2 - box.r);
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

// 촘촘하게 나뉜 상자를 모서리가 둥근 상자로 바꾼다.
export function roundedBox(w, h, d, r, density) {
  const seg = (s) => Math.max(2, Math.round(s * density));
  const g = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d)).toNonIndexed();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const hx = w / 2, hy = h / 2, hz = d / 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ix = clamp(x, hx - r), iy = clamp(y, hy - r), iz = clamp(z, hz - r);
    let nx = x - ix, ny = y - iy, nz = z - iz;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    p.setXYZ(i, ix + nx * r, iy + ny * r, iz + nz * r);
    n.setXYZ(i, nx, ny, nz);
  }
  g.deleteAttribute('uv');
  return g;
}

// 윗면 글씨 텍스처 좌표 (윗면이 아니면 텍스처 바깥 = 가장자리 바탕색)
function topUV(x, z, ny) {
  if (ny <= 0.5) return [-1, -1];
  return [(x + LABEL.w / 2) / LABEL.w, 1 - (z + LABEL.d / 2) / LABEL.d];
}

// 비누: 윗면에 글씨 텍스처, 눌림 자국을 낼 수 있게 꼭짓점을 공유시킨다.
export function soapGeometry() {
  const g = roundedBox(SOAP.w, SOAP.h, SOAP.d, SOAP.r, 16);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const [u, v] = topUV(p.getX(i), p.getZ(i), n.getY(i));
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const merged = mergeVertices(g, 1e-4);
  merged.computeVertexNormals();
  return merged;
}

// 볼록 다각형을 평면 n·x <= d 쪽만 남기고 자른다. 변마다 원래 변('o')인지 깨진 자리('c')인지 기억한다.
function clip(poly, labels, n, d) {
  const out = [], outL = [];
  const L = poly.length;
  const side = (p) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d;
  for (let i = 0; i < L; i++) {
    const A = poly[i], B = poly[(i + 1) % L], lab = labels[i];
    const da = side(A), db = side(B);
    const cut = () => {
      const t = da / (da - db);
      return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
    };
    if (da <= 0) {
      out.push(A);
      outL.push(lab);
      if (db > 0) { out.push(cut()); outL.push('c'); }
    } else if (db <= 0) {
      out.push(cut());
      outL.push(lab);
    }
  }
  return [out, outL];
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// 다각형들을 씨앗별 보로노이 칸으로 나눈다. 결과: 씨앗마다 다각형 목록
export function splitPolys(polys, seeds, K = 9) {
  const groups = seeds.map(() => []);
  for (const poly of polys) {
    const c = [0, 0, 0];
    poly.p.forEach((q) => { c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; });
    c[0] /= poly.p.length; c[1] /= poly.p.length; c[2] /= poly.p.length;
    const near = seeds.map((s, k) => [dist2(s, c), k]).sort((a, b) => a[0] - b[0]).slice(0, K).map((x) => x[1]);
    for (const s of near) {
      let p = poly.p, l = poly.l;
      const S = seeds[s];
      for (const j of near) {
        if (j === s) continue;
        const Q = seeds[j];
        const n = [Q[0] - S[0], Q[1] - S[1], Q[2] - S[2]];
        const d = (Q[0] ** 2 + Q[1] ** 2 + Q[2] ** 2 - S[0] ** 2 - S[1] ** 2 - S[2] ** 2) / 2;
        [p, l] = clip(p, l, n, d);
        if (p.length < 3) break;
      }
      if (p.length >= 3) groups[s].push({ p, l });
    }
  }
  return groups;
}

// 처음 상태: 왁스 껍질을 큼직한 조각 count개로 나눈 다각형 묶음들
export function initialWaxPolys(count = 30) {
  const g = roundedBox(OUTER.w, OUTER.h, OUTER.d, OUTER.r, 9);
  const P = g.attributes.position.array;
  const T = P.length / 9;
  const tri = (i, k) => [P[i * 9 + k * 3], P[i * 9 + k * 3 + 1], P[i * 9 + k * 3 + 2]];
  const polys = [];
  const areas = [];
  let total = 0;
  for (let i = 0; i < T; i++) {
    const p = [tri(i, 0), tri(i, 1), tri(i, 2)];
    polys.push({ p, l: ['o', 'o', 'o'] });
    const a = polyArea(p);
    areas.push(a);
    total += a;
  }
  const seeds = [];
  const minD2 = (Math.sqrt(total / count) * 0.75) ** 2;
  for (let tries = 0; seeds.length < count && tries < count * 80; tries++) {
    let r = Math.random() * total, i = 0;
    while (i < T - 1 && (r -= areas[i]) > 0) i++;
    const c = polys[i].p;
    const q = [0, 1, 2].map((k) => (c[0][k] + c[1][k] + c[2][k]) / 3);
    if (seeds.every((s) => dist2(s, q) > minD2)) seeds.push(q);
  }
  return splitPolys(polys, seeds).filter((g2) => g2.length);
}

// 누른 자리 P(덩어리 기준 좌표)를 중심으로 거미줄 모양 씨앗: 바큇살 방향으로 고리마다 하나씩
export function webSeeds(P) {
  const N = roundNormal(P);
  const a = Math.abs(N[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let T1 = [N[1] * a[2] - N[2] * a[1], N[2] * a[0] - N[0] * a[2], N[0] * a[1] - N[1] * a[0]];
  const l1 = Math.hypot(...T1);
  T1 = T1.map((x) => x / l1);
  const T2 = [N[1] * T1[2] - N[2] * T1[1], N[2] * T1[0] - N[0] * T1[2], N[0] * T1[1] - N[1] * T1[0]];

  const seeds = [[...P]];
  const rings = [0.09, 0.2, 0.36, 0.58, 0.88, 1.28];
  const spokes = 6 + Math.floor(Math.random() * 3);
  const offset = Math.random() * Math.PI * 2;
  // 바큇살 방향은 고리마다 거의 같게 (그래야 금이 길게 뻗어 나간다)
  const angles = Array.from({ length: spokes }, (_, j) => offset + ((j + (Math.random() - 0.5) * 0.4) * Math.PI * 2) / spokes);
  rings.forEach((r, k) => {
    const n = k === 0 ? 4 : spokes;
    for (let j = 0; j < n; j++) {
      const th = (k === 0 ? offset + (j * Math.PI * 2) / n : angles[j]) + (Math.random() - 0.5) * 0.12;
      const rr = r * (1 + (Math.random() - 0.5) * 0.3);
      const c = Math.cos(th) * rr, s = Math.sin(th) * rr;
      seeds.push([P[0] + T1[0] * c + T2[0] * s, P[1] + T1[1] * c + T2[1] * s, P[2] + T1[2] * c + T2[2] * s]);
    }
  });
  return seeds;
}

function polyArea(p) {
  let a = 0;
  for (let k = 1; k < p.length - 1; k++) {
    const u = [p[k][0] - p[0][0], p[k][1] - p[0][1], p[k][2] - p[0][2]];
    const v = [p[k + 1][0] - p[0][0], p[k + 1][1] - p[0][1], p[k + 1][2] - p[0][2]];
    a += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return a;
}

// 다각형 묶음 하나로 왁스 파편 하나를 만든다: 바깥면(글씨 텍스처)·안쪽면, 깨진 자리의 단면
export function buildPiece(polys) {
  const t = WAX.t;
  const pos = [], nrm = [], col = [], uv = [];
  const wpos = [], wnrm = [];
  const ctr = [0, 0, 0], nsum = [0, 0, 0];
  let area = 0;
  const pushV = (arr, v) => arr.push(v[0], v[1], v[2]);
  const neg = (v) => [-v[0], -v[1], -v[2]];

  for (const { p: poly, l: labels } of polys) {
    const nr = poly.map((q) => roundNormal(q));
    const inn = poly.map((q, k) => [q[0] - nr[k][0] * t, q[1] - nr[k][1] * t, q[2] - nr[k][2] * t]);
    const a = polyArea(poly);
    const pc = [0, 0, 0];
    poly.forEach((q) => { pc[0] += q[0] / poly.length; pc[1] += q[1] / poly.length; pc[2] += q[2] / poly.length; });

    for (let k = 1; k < poly.length - 1; k++) {
      for (const i of [0, k, k + 1]) {
        pushV(pos, poly[i]); pushV(nrm, nr[i]); col.push(1, 1, 1);
        uv.push(...topUV(poly[i][0], poly[i][2], nr[i][1]));
      }
      for (const i of [0, k + 1, k]) {
        pushV(pos, inn[i]); pushV(nrm, neg(nr[i])); col.push(0.93, 0.93, 0.93);
        uv.push(-1, -1);
      }
    }

    for (let k = 0; k < poly.length; k++) {
      if (labels[k] !== 'c') continue;
      const k2 = (k + 1) % poly.length;
      const A = poly[k], B = poly[k2], Ai = inn[k], Bi = inn[k2];
      const e = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const f = [Bi[0] - A[0], Bi[1] - A[1], Bi[2] - A[2]];
      let fn = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]];
      const len = Math.hypot(...fn) || 1;
      fn = fn.map((x) => x / len);
      const dir = [(A[0] + B[0]) / 2 - pc[0], (A[1] + B[1]) / 2 - pc[1], (A[2] + B[2]) / 2 - pc[2]];
      if (fn[0] * dir[0] + fn[1] * dir[1] + fn[2] * dir[2] >= 0) {
        [A, B, Bi, A, Bi, Ai].forEach((v) => pushV(wpos, v));
      } else {
        [A, Ai, Bi, A, Bi, B].forEach((v) => pushV(wpos, v));
        fn = neg(fn);
      }
      for (let m = 0; m < 6; m++) pushV(wnrm, fn);
    }

    ctr[0] += pc[0] * a; ctr[1] += pc[1] * a; ctr[2] += pc[2] * a;
    const pn = roundNormal(pc);
    nsum[0] += pn[0] * a; nsum[1] += pn[1] * a; nsum[2] += pn[2] * a;
    area += a;
  }

  const center = new THREE.Vector3(...ctr).divideScalar(area || 1);
  const normal = new THREE.Vector3(...nsum).normalize();
  const shift = (arr) => {
    const f = new Float32Array(arr);
    for (let k = 0; k < f.length; k += 3) { f[k] -= center.x; f[k + 1] -= center.y; f[k + 2] -= center.z; }
    return f;
  };

  // 단면도 같은 메시에 합친다 (파편 하나 = 그리기 한 번)
  for (let k = 0; k < wpos.length; k += 3) col.push(0.78, 0.78, 0.78);
  for (let k = 0; k < wpos.length; k += 3) uv.push(-1, -1);
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.BufferAttribute(shift(pos.concat(wpos)), 3));
  body.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm.concat(wnrm)), 3));
  body.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  body.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  body.computeBoundingSphere();
  return { center, normal, area, polys, body, wall: null, radius: body.boundingSphere.radius };
}
