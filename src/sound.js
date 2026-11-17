// 왁스가 깨지는 소리. 녹음 파일 대신 처음에 소리 조각 여러 개를 만들어 두고 무작위로 골라 튼다.
// "탁" 하는 첫 소리 + 잘게 이어지는 "바사삭" 잔금 소리로 이루어진다.
let ctx = null;
let master = null;
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
    for (let i = 0; i < 6; i++) cracks.push(makeCrack());
    for (let i = 0; i < 5; i++) ticks.push(makeTick());
  }
  if (ctx.state === 'suspended') ctx.resume();
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
