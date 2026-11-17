// 위에서 팔랑팔랑 떨어지는 색종이. 바닥에 닿으면 그대로 쌓인다.
import * as THREE from 'three';

const COLORS = [0xe63946, 0xf4a261, 0xe9c46a, 0x2a9d8f, 0x457b9d, 0xb5179e, 0xffffff, 0x80ed99];

export function makeConfetti(scene, floorY, count = 260) {
  const geo = new THREE.PlaneGeometry(0.09, 0.15);
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6, metalness: 0.1 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);

  const color = new THREE.Color();
  const parts = Array.from({ length: count }, (_, i) => {
    mesh.setColorAt(i, color.setHex(COLORS[i % COLORS.length]));
    return {
      pos: new THREE.Vector3(),
      rot: new THREE.Euler(),
      spin: new THREE.Vector3(),
      fall: 0, sway: 0, phase: 0, delay: 0, landed: false,
    };
  });
  mesh.instanceColor.needsUpdate = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  let running = false;

  return {
    start() {
      running = true;
      mesh.visible = true;
      for (const p of parts) {
        p.pos.set((Math.random() - 0.5) * 9, 6 + Math.random() * 3, (Math.random() - 0.5) * 6 + 0.5);
        p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        p.spin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
        p.fall = 1.1 + Math.random() * 0.9;
        p.sway = 0.4 + Math.random() * 0.6;
        p.phase = Math.random() * Math.PI * 2;
        p.delay = Math.random() * 1.2;
        p.landed = false;
      }
    },
    update(dt) {
      if (!running) return;
      let moving = false;
      parts.forEach((p, i) => {
        if (!p.landed) {
          if (p.delay > 0) {
            p.delay -= dt;
            moving = true;
          } else {
            p.phase += dt * 3;
            p.pos.y -= p.fall * dt;
            p.pos.x += Math.sin(p.phase) * p.sway * dt;
            p.pos.z += Math.cos(p.phase * 0.7) * p.sway * 0.5 * dt;
            p.rot.x += p.spin.x * dt;
            p.rot.y += p.spin.y * dt;
            p.rot.z += p.spin.z * dt;
            if (p.pos.y <= floorY + 0.005) {
              // 바닥에 납작하게 눕는다
              p.pos.y = floorY + 0.004 + Math.random() * 0.002;
              p.rot.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
              p.landed = true;
            }
            moving = true;
          }
        }
        m.compose(p.delay > 0 ? p.pos.clone().setY(100) : p.pos, q.setFromEuler(p.rot), one);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (!moving) running = false;
    },
  };
}
