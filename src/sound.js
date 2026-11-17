// 게임 소리. 소리 후보는 sound-variants.js에 있고, 어떤 후보를 쓸지는 아래 CHOICE에서 고른다
// (번호는 0부터: sounds.html 화면의 1번 = 0. 배열이면 그중에서 매번 무작위로). 녹음 파일 없이 코드로 만든다.
// 모든 소리는 master를 거쳐 스피커와 녹화용 출력(recordDest)으로 같이 나간다.
import { VARIANTS, toBuffer, ROLL_BG } from './sound-variants.js';

export const CHOICE = {
  crack: [0, 2], // 왁스 깨지는 소리: 탁+바사삭과 두꺼운 왁스 뽀각을 섞어서
  tick: 0, // 파편이 바닥에 떨어지는 소리: 틱
  roll: 4, // 시작: 스네어 롤이 크게 시작해 잔잔해지고, 글씨가 드러날 때까지 배경에 깔린다
  whistle: 1, // 휘파람: 휘이익~ 휘익 (1번에서 앞뒤 음·길이 바꿈)
  cheer: 2, // 환호: 관객 "와아~"+박수
};

let ctx = null;
let master = null;
let recordDest = null;
const pool = {}; // 무작위로 골라 쓸 소리 조각들 (깨지는 소리·떨어지는 소리)
let lastTicks = [];

const chosen = (key) => {
  const c = CHOICE[key];
  return VARIANTS[key].list[Array.isArray(c) ? c[Math.floor(Math.random() * c.length)] : c];
};
const make = (key) => toBuffer(ctx, chosen(key).make(ctx.sampleRate));
let rollLoop = null;

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    if (ctx.createMediaStreamDestination) {
      recordDest = ctx.createMediaStreamDestination();
      master.connect(recordDest);
    }
    pool.crack = Array.from({ length: 8 }, () => make('crack'));
    pool.tick = Array.from({ length: 5 }, () => make('tick'));
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// 영상 녹화에 넣을 소리 트랙 (없으면 null)
export function audioTrack() {
  return recordDest?.stream.getAudioTracks()[0] ?? null;
}

// 시작 소리. 고른 후보에 배경 반복(loop)이 있으면 시작 부분 뒤로 이어서 계속 깐다 (stopRoll로 멈춤)
export function drumroll() {
  if (!ctx) return;
  const v = chosen('roll');
  if (!v.loop) { play(make('roll'), 0.9, 1, 0); return; }
  const sr = ctx.sampleRate;
  const intro = toBuffer(ctx, [v.intro(sr)]);
  play(intro, 0.9, 1, 0);
  const src = ctx.createBufferSource();
  src.buffer = toBuffer(ctx, [v.loop(sr)]);
  src.loop = true;
  const g = ctx.createGain();
  g.gain.value = 0.9 * ROLL_BG;
  src.connect(g).connect(master);
  src.start(ctx.currentTime + 2.6);
  rollLoop = { src, g };
}
export function stopRoll() {
  if (!rollLoop) return;
  const { src, g } = rollLoop;
  const t = ctx.currentTime;
  g.gain.setValueAtTime(g.gain.value, t);
  g.gain.linearRampToValueAtTime(0, t + 0.6);
  src.stop(t + 0.7);
  rollLoop = null;
}
export function whistle(delay = 0) {
  if (ctx) play(make('whistle'), 0.8, 1, delay);
}
export function cheer(delay = 0) {
  if (ctx) play(make('cheer'), 0.8, 1, delay);
}

// strength: 이번에 떨어진 조각 수 정도
export function crack(strength = 1, delay = 0) {
  if (!ctx) return;
  const s = Math.min(1, strength / 6);
  play(pickRandom(pool.crack), 0.55 + 0.45 * s, 0.85 + Math.random() * 0.35, delay);
  if (strength >= 4) play(pickRandom(pool.crack), 0.35 * s, 1.1 + Math.random() * 0.3, delay + 0.035);
}

// 조각이 바닥에 떨어질 때
export function tick() {
  if (!ctx) return;
  const now = ctx.currentTime;
  lastTicks = lastTicks.filter((x) => now - x < 0.12);
  if (lastTicks.length >= 4) return;
  lastTicks.push(now);
  play(pickRandom(pool.tick), 0.08 + Math.random() * 0.12, 0.8 + Math.random() * 0.8, 0);
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
