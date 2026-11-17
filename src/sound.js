// 게임 소리. 소리 후보는 sound-variants.js에 있고, 어떤 후보를 쓸지는 아래 CHOICE에서 고른다
// (번호는 0부터: sounds.html 화면의 1번 = 0). 녹음 파일 없이 코드로 만든다.
// 모든 소리는 master를 거쳐 스피커와 녹화용 출력(recordDest)으로 같이 나간다.
import { VARIANTS, toBuffer } from './sound-variants.js';

export const CHOICE = {
  crack: 0, // 왁스 깨지는 소리
  tick: 0, // 파편이 바닥에 떨어지는 소리
  roll: 0, // 시작할 때 두구두구… 둥!
  whistle: 0, // 글씨가 드러날 때 휘파람
  cheer: 0, // 글씨가 드러날 때 환호
};

let ctx = null;
let master = null;
let recordDest = null;
const pool = {}; // 무작위로 골라 쓸 소리 조각들 (깨지는 소리·떨어지는 소리)
let lastTicks = [];

const make = (key) => toBuffer(ctx, VARIANTS[key].list[CHOICE[key]].make(ctx.sampleRate));

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
    pool.crack = Array.from({ length: 6 }, () => make('crack'));
    pool.tick = Array.from({ length: 5 }, () => make('tick'));
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// 영상 녹화에 넣을 소리 트랙 (없으면 null)
export function audioTrack() {
  return recordDest?.stream.getAudioTracks()[0] ?? null;
}

export function drumroll() {
  if (ctx) play(make('roll'), 0.9, 1, 0);
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
