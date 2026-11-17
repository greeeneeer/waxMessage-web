// 무대: 어두운 배경, 양옆 빨간 커튼, 마룻바닥, 위에서 내리꽂는 핀 조명(빛기둥이 보임).
import * as THREE from 'three';

export function buildStage(scene, { floorY, targetY }) {
  const top = 9;

  // 핀 조명
  const spot = new THREE.SpotLight(0xfff0dc, 3.4, 0, 0.3, 0.45, 0);
  spot.position.set(0, top, 0);
  spot.target.position.set(0, floorY, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 3;
  spot.shadow.camera.far = 16;
  spot.shadow.bias = -0.0004;
  scene.add(spot, spot.target);

  // 객석 쪽에서 아주 약하게 비추는 빛 (커튼 주름과 덩어리 앞면이 살짝 보이도록)
  const fill = new THREE.DirectionalLight(0xffd9c4, 0.4);
  fill.position.set(0, 3, 12);
  scene.add(fill, new THREE.AmbientLight(0xffffff, 0.04));

  // 보이는 빛기둥
  const beamH = top - floorY;
  const beamR = Math.tan(0.3) * beamH * 1.02;
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(beamR, beamH, 64, 1, true),
    new THREE.ShaderMaterial({
      uniforms: { uH: { value: beamH }, uColor: { value: new THREE.Color(0xfff0dc) }, uStrength: { value: 0.4 } },
      vertexShader: `
        uniform float uH;
        varying vec3 vN; varying vec3 vW; varying float vH;
        void main() {
          vH = (position.y + uH * 0.5) / uH;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uStrength;
        varying vec3 vN; varying vec3 vW; varying float vH;
        void main() {
          vec3 v = normalize(cameraPosition - vW);
          float f = abs(dot(normalize(vN), v));
          float a = pow(f, 2.5) * mix(0.3, 1.0, vH) * uStrength;
          gl_FragColor = vec4(uColor * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  beam.position.y = floorY + beamH / 2;
  scene.add(beam);

  // 마룻바닥
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 30),
    new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.6, envMapIntensity: 0.12 }),
  );
  floor.material.map.repeat.set(10, 7.5);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, floorY, 5);
  floor.receiveShadow = true;
  scene.add(floor);

  // 뒷벽 (어둠)
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 30),
    new THREE.MeshStandardMaterial({ color: 0x100c0d, roughness: 1, envMapIntensity: 0 }),
  );
  back.position.set(0, floorY + 15, -6);
  scene.add(back);

  // 커튼 (주름진 빨간 천)
  const curtains = [-1, 1].map((side) => {
    const m = new THREE.Mesh(curtainGeometry(7, 16), new THREE.MeshStandardMaterial({
      color: 0x8a1020, roughness: 0.8, vertexColors: true, envMapIntensity: 0.12, side: THREE.DoubleSide,
    }));
    m.position.set(side * 6, floorY, -0.8);
    m.userData.side = side;
    m.castShadow = false;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  });

  return {
    // 화면 가장자리에 커튼이 걸리도록 (halfW: 커튼 깊이에서 화면 절반 너비)
    fit(halfW) {
      const inner = Math.max(2.4, halfW * 0.76);
      for (const c of curtains) c.position.x = c.userData.side * (inner + 3.5);
    },
    update() { /* 지금은 움직이는 것 없음 */ },
  };
}

// 세로로 주름진 천. 아래는 바닥에, 위로 갈수록 어두워진다.
function curtainGeometry(width, height) {
  const g = new THREE.PlaneGeometry(width, height, 140, 12);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i) + height / 2; // 0 = 바닥
    const fold = Math.sin(x * 9.5) * 0.18 + Math.sin(x * 4.1 + 1.3) * 0.12;
    p.setZ(i, fold);
    p.setY(i, y);
    const shade = THREE.MathUtils.lerp(1, 0.35, Math.min(1, y / height));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// 앞뒤로 길게 놓인 마루 판자
function woodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const planks = 4;
  const pw = c.width / planks;
  for (let i = 0; i < planks; i++) {
    // 판자마다 길이 방향 이음매 위치가 다르다
    const joints = [Math.random() * c.height, Math.random() * c.height];
    let y0 = 0;
    for (const yj of [...joints.sort((a, b) => a - b), c.height]) {
      const hue = 26 + Math.random() * 6;
      const light = 30 + Math.random() * 10;
      ctx.fillStyle = `hsl(${hue}, 45%, ${light}%)`;
      ctx.fillRect(i * pw, y0, pw, yj - y0);
      // 나뭇결
      for (let k = 0; k < 14; k++) {
        ctx.strokeStyle = `hsla(${hue}, 40%, ${light - 8 + Math.random() * 6}%, 0.5)`;
        ctx.lineWidth = 1 + Math.random() * 1.5;
        const x = i * pw + Math.random() * pw;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.bezierCurveTo(x + (Math.random() - 0.5) * 8, y0 + (yj - y0) / 3, x + (Math.random() - 0.5) * 8, y0 + ((yj - y0) * 2) / 3, x + (Math.random() - 0.5) * 6, yj);
        ctx.stroke();
      }
      // 이음매
      ctx.fillStyle = 'rgba(20, 10, 5, 0.6)';
      ctx.fillRect(i * pw, yj - 1.5, pw, 3);
      y0 = yj;
    }
    // 판자 사이 틈
    ctx.fillStyle = 'rgba(15, 8, 4, 0.75)';
    ctx.fillRect(i * pw, 0, 3, c.height);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
