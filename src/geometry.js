// 둥근 비누 모양과, 미리 조각내 둔 왁스 껍질.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SOAP, LABEL } from './share.js';

// 왁스: 비누 표면에서 gap만큼 떨어져 두께 t로 덮는다
export const WAX = { gap: 0.015, t: 0.1 };
const grow = WAX.gap + WAX.t;
export const OUTER = { w: SOAP.w + 2 * grow, h: SOAP.h + 2 * grow, d: SOAP.d + 2 * grow, r: SOAP.r + grow };

const clamp = (v, m) => Math.max(-m, Math.min(m, v));

// 둥근 상자 표면 위 점의 바깥 방향
function roundNormal(p, box) {
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

// 비누: 윗면에 글씨 텍스처가 입혀지도록 위에서 내려다본 좌표를 붙이고, 눌림 자국을 낼 수 있게 꼭짓점을 공유시킨다.
export function soapGeometry() {
  const g = roundedBox(SOAP.w, SOAP.h, SOAP.d, SOAP.r, 16);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    if (n.getY(i) > 0.5) {
      uv[i * 2] = (p.getX(i) + LABEL.w / 2) / LABEL.w;
      uv[i * 2 + 1] = 1 - (p.getZ(i) + LABEL.d / 2) / LABEL.d;
    } else {
      uv[i * 2] = -1; // 텍스처 바깥 = 가장자리 색(클레이 색)
      uv[i * 2 + 1] = -1;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const merged = mergeVertices(g, 1e-4);
  merged.computeVertexNormals();
  return merged;
}

// 볼록 다각형을 평면 n·x <= d 쪽만 남기고 자른다. 변마다 원래 변('o')인지 잘린 자리('c')인지 기억한다.
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

// 왁스 껍질을 약 count개의 파편으로 나눈다 (3D 보로노이로 정확히 잘라서 가장자리가 매끈한 직선/곡선이 된다).
// 조각마다 바깥면·안쪽면(body)과, 떨어질 때 보이는 단면(wall)을 만든다.
export function buildWaxChunks(count = 90) {
  const g = roundedBox(OUTER.w, OUTER.h, OUTER.d, OUTER.r, 8);
  const P = g.attributes.position.array;
  const T = P.length / 9;
  const t = WAX.t;
  const tri = (i, k) => [P[i * 9 + k * 3], P[i * 9 + k * 3 + 1], P[i * 9 + k * 3 + 2]];

  // 삼각형 넓이 (씨앗을 표면에 고르게 뿌리기 위해)
  const area = new Float32Array(T);
  let total = 0;
  for (let i = 0; i < T; i++) {
    const a = tri(i, 0), b = tri(i, 1), c = tri(i, 2);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    area[i] = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    total += area[i];
  }
  const randomSurfacePoint = () => {
    let r = Math.random() * total, i = 0;
    while (i < T - 1 && (r -= area[i]) > 0) i++;
    let s = Math.random(), q = Math.random();
    if (s + q > 1) { s = 1 - s; q = 1 - q; }
    const a = tri(i, 0), b = tri(i, 1), c = tri(i, 2);
    return [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * s + (c[k] - a[k]) * q);
  };

  // 씨앗: 크고 작은 파편이 섞이도록 간격을 느슨하게
  const minD2 = (Math.sqrt(total / count) * 0.7) ** 2;
  const seeds = [];
  for (let tries = 0; seeds.length < count && tries < count * 60; tries++) {
    const p = randomSurfacePoint();
    if (seeds.every((s) => (s[0] - p[0]) ** 2 + (s[1] - p[1]) ** 2 + (s[2] - p[2]) ** 2 > minD2)) seeds.push(p);
  }

  const parts = seeds.map(() => ({ pos: [], nrm: [], col: [], wpos: [], wnrm: [], ctr: [0, 0, 0], nsum: [0, 0, 0], ar: 0 }));
  const pushV = (arr, v) => arr.push(v[0], v[1], v[2]);
  const inner = (p, n) => [p[0] - n[0] * t, p[1] - n[1] * t, p[2] - n[2] * t];
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  for (let i = 0; i < T; i++) {
    const a = tri(i, 0), b = tri(i, 1), c = tri(i, 2);
    const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const near = seeds.map((s, k) => [dist2(s, cen), k]).sort((x, y) => x[0] - y[0]).slice(0, 9).map((x) => x[1]);

    for (const s of near) {
      let poly = [a, b, c];
      let labels = ['o', 'o', 'o'];
      const S = seeds[s];
      for (const j of near) {
        if (j === s) continue;
        const Q = seeds[j];
        const n = [Q[0] - S[0], Q[1] - S[1], Q[2] - S[2]];
        const d = (Q[0] ** 2 + Q[1] ** 2 + Q[2] ** 2 - S[0] ** 2 - S[1] ** 2 - S[2] ** 2) / 2;
        [poly, labels] = clip(poly, labels, n, d);
        if (poly.length < 3) break;
      }
      if (poly.length < 3) continue;

      const part = parts[s];
      const nr = poly.map((p) => roundNormal(p, OUTER));
      const inn = poly.map((p, k) => inner(p, nr[k]));
      const pc = [0, 0, 0];
      poly.forEach((p) => { pc[0] += p[0] / poly.length; pc[1] += p[1] / poly.length; pc[2] += p[2] / poly.length; });

      // 바깥면, 안쪽면 (부채꼴로 삼각형 나누기)
      for (let k = 1; k < poly.length - 1; k++) {
        pushV(part.pos, poly[0]); pushV(part.pos, poly[k]); pushV(part.pos, poly[k + 1]);
        pushV(part.nrm, nr[0]); pushV(part.nrm, nr[k]); pushV(part.nrm, nr[k + 1]);
        pushV(part.pos, inn[0]); pushV(part.pos, inn[k + 1]); pushV(part.pos, inn[k]);
        pushV(part.nrm, nr[0].map((x) => -x)); pushV(part.nrm, nr[k + 1].map((x) => -x)); pushV(part.nrm, nr[k].map((x) => -x));
        part.col.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93);
      }

      // 잘린 자리에는 단면(벽)
      for (let k = 0; k < poly.length; k++) {
        if (labels[k] !== 'c') continue;
        const A = poly[k], B = poly[(k + 1) % poly.length];
        const Ai = inn[k], Bi = inn[(k + 1) % poly.length];
        const e = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
        const f = [Bi[0] - A[0], Bi[1] - A[1], Bi[2] - A[2]];
        let fn = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]];
        const len = Math.hypot(...fn) || 1;
        fn = fn.map((x) => x / len);
        const dir = [(A[0] + B[0]) / 2 - pc[0], (A[1] + B[1]) / 2 - pc[1], (A[2] + B[2]) / 2 - pc[2]];
        if (fn[0] * dir[0] + fn[1] * dir[1] + fn[2] * dir[2] >= 0) {
          [A, B, Bi, A, Bi, Ai].forEach((v) => pushV(part.wpos, v));
        } else {
          [A, Ai, Bi, A, Bi, B].forEach((v) => pushV(part.wpos, v));
          fn = fn.map((x) => -x);
        }
        for (let m = 0; m < 6; m++) pushV(part.wnrm, fn);
      }

      // 조각 중심과 평균 방향 (대략 넓이 가중)
      const w = poly.length;
      part.ctr[0] += pc[0] * w; part.ctr[1] += pc[1] * w; part.ctr[2] += pc[2] * w;
      const pn = roundNormal(pc, OUTER);
      part.nsum[0] += pn[0] * w; part.nsum[1] += pn[1] * w; part.nsum[2] += pn[2] * w;
      part.ar += w;
    }
  }

  return parts
    .filter((p) => p.ar > 0)
    .map((p) => {
      const center = new THREE.Vector3(...p.ctr).divideScalar(p.ar);
      const normal = new THREE.Vector3(...p.nsum).normalize();
      const shift = (arr) => {
        const f = new Float32Array(arr);
        for (let k = 0; k < f.length; k += 3) { f[k] -= center.x; f[k + 1] -= center.y; f[k + 2] -= center.z; }
        return f;
      };
      const body = new THREE.BufferGeometry();
      body.setAttribute('position', new THREE.BufferAttribute(shift(p.pos), 3));
      body.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(p.nrm), 3));
      body.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.col), 3));
      body.computeBoundingSphere();

      let wall = null;
      if (p.wpos.length) {
        wall = new THREE.BufferGeometry();
        wall.setAttribute('position', new THREE.BufferAttribute(shift(p.wpos), 3));
        wall.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(p.wnrm), 3));
        wall.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.wpos.length).fill(0.9), 3));
      }
      return { center, normal, body, wall };
    });
}
