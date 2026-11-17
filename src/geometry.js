// 둥근 비누 모양과, 미리 조각내 둔 왁스 껍질.
import * as THREE from 'three';
import { SOAP } from './share.js';

// 왁스: 비누 표면에서 gap만큼 떨어져 두께 t로 덮는다
export const WAX = { gap: 0.02, t: 0.07 };
const grow = WAX.gap + WAX.t;
export const OUTER = { w: SOAP.w + 2 * grow, h: SOAP.h + 2 * grow, d: SOAP.d + 2 * grow, r: SOAP.r + grow };

const clamp = (v, m) => Math.max(-m, Math.min(m, v));

// 촘촘하게 나뉜 상자를 모서리가 둥근 상자로 바꾼다. 평평한 면도 고르게 잘게 나뉘어 있어 조각내기 좋다.
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

// 왁스 껍질을 보로노이 방식으로 약 count개 조각으로 나눈다.
// 조각마다 바깥면·안쪽면(body)과, 깨졌을 때만 보이는 단면(wall)을 따로 만든다.
export function buildWaxChunks(count = 110) {
  const g = roundedBox(OUTER.w, OUTER.h, OUTER.d, OUTER.r, 14);
  const P = g.attributes.position.array;
  const N = g.attributes.normal.array;
  const T = P.length / 9;
  const t = WAX.t;

  // 삼각형 중심과 넓이
  const cen = new Float32Array(T * 3);
  const area = new Float32Array(T);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  let total = 0;
  for (let i = 0; i < T; i++) {
    a.fromArray(P, i * 9); b.fromArray(P, i * 9 + 3); c.fromArray(P, i * 9 + 6);
    cen[i * 3] = (a.x + b.x + c.x) / 3;
    cen[i * 3 + 1] = (a.y + b.y + c.y) / 3;
    cen[i * 3 + 2] = (a.z + b.z + c.z) / 3;
    area[i] = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
    total += area[i];
  }

  // 조각의 씨앗 점: 서로 너무 가깝지 않게 골고루
  const minD2 = (Math.sqrt(total / count) * 0.85) ** 2;
  const order = [...Array(T).keys()];
  for (let i = T - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const seeds = [];
  for (const i of order) {
    if (seeds.length >= count) break;
    const x = cen[i * 3], y = cen[i * 3 + 1], z = cen[i * 3 + 2];
    if (seeds.every((s) => (s[0] - x) ** 2 + (s[1] - y) ** 2 + (s[2] - z) ** 2 > minD2)) seeds.push([x, y, z]);
  }

  // 삼각형마다 가장 가까운 씨앗 = 속한 조각
  const owner = new Int32Array(T);
  for (let i = 0; i < T; i++) {
    let best = 0, bd = Infinity;
    for (let s = 0; s < seeds.length; s++) {
      const dd = (seeds[s][0] - cen[i * 3]) ** 2 + (seeds[s][1] - cen[i * 3 + 1]) ** 2 + (seeds[s][2] - cen[i * 3 + 2]) ** 2;
      if (dd < bd) { bd = dd; best = s; }
    }
    owner[i] = best;
  }

  // 모서리 공유 정보 (같은 위치의 꼭짓점은 같은 키)
  const vkey = new Array(T * 3);
  for (let v = 0; v < T * 3; v++) {
    vkey[v] = `${Math.round(P[v * 3] * 1e4)},${Math.round(P[v * 3 + 1] * 1e4)},${Math.round(P[v * 3 + 2] * 1e4)}`;
  }
  const edgeKey = (i, e) => {
    const ka = vkey[i * 3 + e], kb = vkey[i * 3 + ((e + 1) % 3)];
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const edges = new Map();
  for (let i = 0; i < T; i++) {
    for (let e = 0; e < 3; e++) {
      const k = edgeKey(i, e);
      const list = edges.get(k);
      if (list) list.push(i); else edges.set(k, [i]);
    }
  }

  const parts = seeds.map(() => ({ pos: [], nrm: [], col: [], wpos: [], wnrm: [], ctr: new THREE.Vector3(), nsum: new THREE.Vector3(), ar: 0 }));
  const pv = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  const nv = (v) => [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
  const inner = (v) => { const p = pv(v), n = nv(v); return [p[0] - n[0] * t, p[1] - n[1] * t, p[2] - n[2] * t]; };
  const push = (arr, ...vs) => vs.forEach((v) => arr.push(v[0], v[1], v[2]));

  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), pbi = new THREE.Vector3();
  const fn = new THREE.Vector3(), dir = new THREE.Vector3();

  for (let i = 0; i < T; i++) {
    const part = parts[owner[i]];
    const v0 = i * 3, v1 = i * 3 + 1, v2 = i * 3 + 2;

    // 바깥면
    push(part.pos, pv(v0), pv(v1), pv(v2));
    push(part.nrm, nv(v0), nv(v1), nv(v2));
    part.col.push(1, 1, 1, 1, 1, 1, 1, 1, 1);
    // 안쪽면 (뒤집어서)
    push(part.pos, inner(v0), inner(v2), inner(v1));
    const neg = (v) => nv(v).map((x) => -x);
    push(part.nrm, neg(v0), neg(v2), neg(v1));
    part.col.push(0.94, 0.94, 0.94, 0.94, 0.94, 0.94, 0.94, 0.94, 0.94);

    part.ctr.x += cen[i * 3] * area[i];
    part.ctr.y += cen[i * 3 + 1] * area[i];
    part.ctr.z += cen[i * 3 + 2] * area[i];
    part.ar += area[i];
    part.nsum.x += N[v0 * 3] * area[i];
    part.nsum.y += N[v0 * 3 + 1] * area[i];
    part.nsum.z += N[v0 * 3 + 2] * area[i];

    // 다른 조각과 맞닿은 모서리에는 단면(벽)을 세운다
    for (let e = 0; e < 3; e++) {
      const others = edges.get(edgeKey(i, e)).filter((j) => j !== i);
      if (others.length && owner[others[0]] === owner[i]) continue;
      const ia = i * 3 + e, ib = i * 3 + ((e + 1) % 3), ic = i * 3 + ((e + 2) % 3);
      pa.fromArray(pv(ia)); pb.fromArray(pv(ib)); pc.fromArray(pv(ic));
      const ai = inner(ia), bi = inner(ib);
      pbi.fromArray(bi);
      fn.subVectors(pb, pa).cross(ab.subVectors(pbi, pa)).normalize();
      dir.addVectors(pa, pb).multiplyScalar(0.5).sub(pc);
      if (fn.dot(dir) >= 0) {
        push(part.wpos, pv(ia), pv(ib), bi, pv(ia), bi, ai);
      } else {
        push(part.wpos, pv(ia), ai, bi, pv(ia), bi, pv(ib));
        fn.negate();
      }
      for (let k = 0; k < 6; k++) part.wnrm.push(fn.x, fn.y, fn.z);
    }
  }

  return parts
    .filter((p) => p.ar > 0)
    .map((p) => {
      const center = p.ctr.divideScalar(p.ar);
      const normal = p.nsum.normalize();
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
        const col = new Float32Array(p.wpos.length).fill(0.86);
        wall.setAttribute('color', new THREE.BufferAttribute(col, 3));
      }
      return { center, normal, body, wall };
    });
}
