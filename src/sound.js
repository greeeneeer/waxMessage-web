// 왁스가 깨지는 소리. 녹음 파일 대신 처음에 소리 조각 여러 개를 만들어 두고 무작위로 골라 튼다.
// "탁" 하는 첫 소리 + 잘게 이어지는 "바사삭" 잔금 소리로 이루어진다.
// 시작할 때 팀파니 "두구두구… 둥!", 글씨가 드러나면 휘파람·박수·환호도 코드로 만들어 튼다.
// 모든 소리는 master를 거쳐 스피커와 녹화용 출력(recordDest)으로 같이 나간다.
let ctx = null;
let master = null;
let recordDest = null;
let muted = false;
const cracks = [];
const ticks = [];
let lastTicks = [];

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    if (ctx.createMediaStreamDestination) {
      recordDest = ctx.createMediaStreamDestination();
      master.connect(recordDest);
    }
    for (let i = 0; i < 6; i++) cracks.push(makeCrack());
    for (let i = 0; i < 5; i++) ticks.push(makeTick());
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// 영상 녹화에 넣을 소리 트랙 (없으면 null)
export function audioTrack() {
  return recordDest?.stream.getAudioTracks()[0] ?? null;
}

// 중대 발표 전 팀파니 롤: 점점 커지는 "두구두구두구…" 뒤에 "둥!"
export function drumroll() {
  if (!ctx) return;
  const sr = ctx.sampleRate;
  const dur = 3.2;
  const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
  const d = buf.getChannelData(0);
  const hit = (t0, amp, f0, decay) => {
    const start = Math.floor(t0 * sr);
    let phase = 0;
    for (let i = start; i < d.length; i++) {
      const t = (i - start) / sr;
      if (t > decay * 6) break;
      const f = f0 * (1 + 0.12 * Math.exp(-t / 0.04)); // 치는 순간 살짝 높았다가 내려온다
      phase += (2 * Math.PI * f) / sr;
      const env = Math.exp(-t / decay);
      const body = Math.sin(phase) + 0.45 * Math.sin(phase * 1.5) + 0.25 * Math.sin(phase * 2.02);
      const stick = (Math.random() * 2 - 1) * Math.exp(-t / 0.006) * 0.5;
      d[i] += amp * (body * env + stick);
    }
  };
  // 롤: 1초에 약 18번, 점점 크게
  const rollEnd = 2.35;
  for (let t = 0; t < rollEnd; t += 1 / 18 + (Math.random() - 0.5) * 0.008) {
    const k = t / rollEnd;
    hit(t, (0.12 + 0.55 * k * k) * (0.85 + Math.random() * 0.3), 92, 0.25);
  }
  hit(rollEnd + 0.08, 1.4, 82, 0.5); // 둥!
  normalize(d, 0.9);
  play(buf, 0.9, 1, 0);
}

// 휘파람 "휘익~ 휘이익!"
export function whistle(delay = 0) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const glide = (start, len, f1, f2, f3) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f1, start);
    o.frequency.exponentialRampToValueAtTime(f2, start + len * 0.45);
    o.frequency.exponentialRampToValueAtTime(f3, start + len);
    const vib = ctx.createOscillator();
    vib.frequency.value = 7;
    const vibAmt = ctx.createGain();
    vibAmt.gain.value = 18;
    vib.connect(vibAmt).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.22, start + 0.04);
    g.gain.setValueAtTime(0.22, start + len - 0.08);
    g.gain.linearRampToValueAtTime(0, start + len);
    o.connect(g).connect(master);
    o.start(start); vib.start(start);
    o.stop(start + len + 0.05); vib.stop(start + len + 0.05);
  };
  glide(t0, 0.32, 900, 2300, 2100);
  glide(t0 + 0.42, 0.75, 1300, 2700, 950);
}

// 박수와 환호 (약 4초)
export function cheer(delay = 0) {
  if (!ctx) return;
  const sr = ctx.sampleRate;
  const dur = 4.5;
  const buf = ctx.createBuffer(2, Math.floor(sr * dur), sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const env = (t) => Math.min(1, t / 0.35) * (t < 2.8 ? 1 : Math.max(0, 1 - (t - 2.8) / 1.7));
    // 웅성웅성 환호: 거칠게 걸러 낸 잡음이 천천히 출렁인다
    let lp = 0, lp2 = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const n = Math.random() * 2 - 1;
      lp += (n - lp) * 0.18;
      lp2 += (lp - lp2) * 0.5;
      const swell = 0.75 + 0.25 * Math.sin(t * 5.3 + ch) * Math.sin(t * 2.1);
      d[i] += (lp - lp2 * 0.6) * 0.9 * env(t) * swell;
    }
    // 박수: 짧은 잡음 터짐이 빽빽하게
    for (let k = 0; k < 160; k++) {
      const t = Math.random() * 3.6;
      const amp = (0.25 + Math.random() * 0.5) * env(t);
      const start = Math.floor(t * sr);
      const decay = 0.004 + Math.random() * 0.006;
      let prev = 0;
      for (let i = start; i < Math.min(d.length, start + decay * 8 * sr); i++) {
        const n = Math.random() * 2 - 1;
        d[i] += (n - prev * 0.5) * amp * Math.exp(-(i - start) / sr / decay);
        prev = n;
      }
    }
    normalize(d, 0.7);
  }
  // 사람 목소리 "우와~": 톱니파를 모음 소리처럼 걸러서 여러 명
  const t0 = ctx.currentTime + delay;
  for (let v = 0; v < 9; v++) {
    const st = t0 + Math.random() * 0.5;
    const len = 1.4 + Math.random() * 1.6;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 170 + Math.random() * 260;
    o.frequency.setValueAtTime(base, st);
    o.frequency.linearRampToValueAtTime(base * (1.3 + Math.random() * 0.3), st + 0.35);
    o.frequency.linearRampToValueAtTime(base * (0.9 + Math.random() * 0.2), st + len);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass'; f1.frequency.value = 700 + Math.random() * 200; f1.Q.value = 4;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass'; f2.frequency.value = 1150 + Math.random() * 250; f2.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, st);
    g.gain.linearRampToValueAtTime(0.05, st + 0.15);
    g.gain.setValueAtTime(0.05, st + len - 0.4);
    g.gain.linearRampToValueAtTime(0, st + len);
    o.connect(f1).connect(g);
    o.connect(f2).connect(g);
    g.connect(master);
    o.start(st);
    o.stop(st + len + 0.05);
  }
  play(buf, 0.75, 1, delay);
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.9;
}

// strength: 이번에 떨어진 조각 수 정도
export function crack(strength = 1, delay = 0) {
  if (!ctx) return;
  const s = Math.min(1, strength / 6);
  play(pickRandom(cracks), 0.55 + 0.45 * s, 0.85 + Math.random() * 0.35, delay);
  if (strength >= 4) play(pickRandom(cracks), 0.35 * s, 1.1 + Math.random() * 0.3, delay + 0.035);
}

// 조각이 바닥에 떨어질 때 "틱"
export function tick() {
  if (!ctx) return;
  const now = ctx.currentTime;
  lastTicks = lastTicks.filter((x) => now - x < 0.12);
  if (lastTicks.length >= 4) return;
  lastTicks.push(now);
  play(pickRandom(ticks), 0.08 + Math.random() * 0.12, 0.8 + Math.random() * 0.8, 0);
}

function play(buf, vol, rate, delay) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(g).connect(master);
  src.start(ctx.currentTime + delay);
}

const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

// 고음만 남긴 짧은 잡음 터짐을 data에 더한다
function burst(d, sr, t0, amp, decay) {
  const start = Math.floor(t0 * sr);
  const end = Math.min(d.length, start + Math.floor(decay * 7 * sr));
  let prev = 0;
  for (let i = start; i < end; i++) {
    const n = Math.random() * 2 - 1;
    const hp = n - prev * 0.75;
    prev = n;
    d[i] += hp * amp * Math.exp(-(i - start) / sr / decay);
  }
}

function normalize(d, peak) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
}

function makeCrack() {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * 0.4), sr);
  const d = buf.getChannelData(0);
  // 첫 "탁": 날카로운 잡음 + 낮은 울림
  burst(d, sr, 0, 1, 0.006 + Math.random() * 0.006);
  const f = 110 + Math.random() * 90;
  for (let i = 0; i < Math.floor(sr * 0.15); i++) {
    const t = i / sr;
    d[i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.03) * 0.4;
  }
  // 잔금 "바사삭"
  const n = 8 + Math.floor(Math.random() * 14);
  for (let k = 0; k < n; k++) {
    const t0 = 0.004 + Math.random() ** 2 * 0.24;
    const amp = (0.15 + Math.random() * 0.6) * Math.max(0.2, 1 - t0 * 3);
    burst(d, sr, t0, amp, 0.0012 + Math.random() * 0.004);
  }
  normalize(d, 0.95);
  return buf;
}

function makeTick() {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * 0.08), sr);
  const d = buf.getChannelData(0);
  const n = 1 + Math.floor(Math.random() * 3);
  for (let k = 0; k < n; k++) burst(d, sr, Math.random() * 0.03, 0.5 + Math.random() * 0.5, 0.001 + Math.random() * 0.002);
  normalize(d, 0.9);
  return buf;
}
