// 소리 후보들. 녹음 파일 없이 코드로 만든다.
// 종류마다 여러 후보가 있고, sound.js의 CHOICE에서 어떤 후보를 쓸지 고른다.
// 각 후보의 make(sr)는 소리 한 번 분량을 [왼쪽, 오른쪽?] Float32Array 배열로 돌려준다 (부를 때마다 조금씩 다르게).

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);

function buf(sr, sec) {
  return new Float32Array(Math.floor(sr * sec));
}
function normalize(d, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  return d;
}
// RBJ 필터 (bandpass/highpass/lowpass)
function biquad(type, f, q, sr) {
  const w = (TAU * f) / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
  let b0, b1, b2;
  if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  else { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}
// 걸러 낸 잡음 터짐을 d에 더한다
function noiseBurst(d, sr, t0, amp, decay, filter = null, attack = 0) {
  const start = Math.floor(t0 * sr);
  const end = Math.min(d.length, start + Math.floor((decay * 7 + attack) * sr));
  for (let i = start; i < end; i++) {
    const t = (i - start) / sr;
    let n = Math.random() * 2 - 1;
    if (filter) n = filter(n);
    const env = attack > 0 && t < attack ? t / attack : Math.exp(-(t - attack) / decay);
    d[i] += n * amp * env;
  }
}
// 짧게 울리는 사인 (주파수가 f0→f1로 미끄러질 수 있음)
function ping(d, sr, t0, amp, f0, decay, f1 = f0, harm = 0) {
  const start = Math.floor(t0 * sr);
  let ph = 0;
  for (let i = start; i < d.length; i++) {
    const t = (i - start) / sr;
    if (t > decay * 7) break;
    const f = f1 + (f0 - f1) * Math.exp(-t / Math.max(decay * 0.4, 0.001));
    ph += (TAU * f) / sr;
    d[i] += amp * Math.exp(-t / decay) * (Math.sin(ph) + harm * Math.sin(ph * 2.01));
  }
}
// 박수 한 번 (잡음 터짐 세 번이 아주 빠르게)
function clap(d, sr, t0, amp) {
  const bp = biquad('bp', rnd(1000, 1600), 1.2, sr);
  for (let k = 0; k < 3; k++) noiseBurst(d, sr, t0 + k * 0.009, amp * (k === 2 ? 1 : 0.6), k === 2 ? 0.02 : 0.004, bp);
}
// 사람 "와아~" 목소리 한 명: 톱니파를 모음처럼 걸러 낸다
function voice(d, sr, t0, len, base, amp) {
  const f1 = biquad('bp', rnd(650, 850), 4, sr);
  const f2 = biquad('bp', rnd(1100, 1400), 5, sr);
  const start = Math.floor(t0 * sr);
  let ph = 0;
  for (let i = start; i < Math.min(d.length, start + len * sr); i++) {
    const t = (i - start) / sr;
    const glide = t < 0.3 ? 1 + 0.35 * (t / 0.3) : 1.35 - 0.25 * ((t - 0.3) / len);
    const f = base * glide * (1 + 0.02 * Math.sin(t * 31));
    ph = (ph + f / sr) % 1;
    const saw = ph * 2 - 1;
    const env = Math.min(1, t / 0.12) * Math.min(1, (len - t) / 0.4);
    d[i] += (f1(saw) + f2(saw) * 0.7) * amp * env;
  }
}
function timpani(d, sr, t0, amp, f0, decay) {
  const start = Math.floor(t0 * sr);
  let ph = 0;
  for (let i = start; i < d.length; i++) {
    const t = (i - start) / sr;
    if (t > decay * 6) break;
    const f = f0 * (1 + 0.12 * Math.exp(-t / 0.04));
    ph += (TAU * f) / sr;
    const env = Math.exp(-t / decay);
    d[i] += amp * ((Math.sin(ph) + 0.45 * Math.sin(ph * 1.5) + 0.25 * Math.sin(ph * 2.02)) * env + (Math.random() * 2 - 1) * Math.exp(-t / 0.006) * 0.5);
  }
}
function crackles(d, sr, n, spread, ampMax, filter) {
  for (let k = 0; k < n; k++) {
    const t0 = 0.004 + Math.random() ** 2 * spread;
    const amp = rnd(0.15, 1) * ampMax * Math.max(0.2, 1 - t0 / (spread * 1.3));
    noiseBurst(d, sr, t0, amp, rnd(0.0012, 0.005), filter);
  }
}

export const VARIANTS = {
  crack: {
    title: '왁스 깨지는 소리',
    list: [
      {
        name: '탁 + 바사삭 (지금 소리)',
        make(sr) {
          const d = buf(sr, 0.4);
          const hp = biquad('hp', 1500, 0.7, sr);
          noiseBurst(d, sr, 0, 1, rnd(0.006, 0.012), hp);
          ping(d, sr, 0, 0.4, rnd(110, 200), 0.03);
          crackles(d, sr, 8 + Math.floor(Math.random() * 14), 0.24, 0.75, biquad('hp', 1500, 0.7, sr));
          return [normalize(d, 0.95)];
        },
      },
      {
        name: '사탕처럼 쨍 (얇고 높게)',
        make(sr) {
          const d = buf(sr, 0.35);
          noiseBurst(d, sr, 0, 0.9, 0.003, biquad('hp', 4000, 0.7, sr));
          for (let k = 0; k < 5; k++) ping(d, sr, rnd(0, 0.03), rnd(0.15, 0.35), rnd(2500, 6500), rnd(0.02, 0.07));
          crackles(d, sr, 6, 0.12, 0.4, biquad('hp', 3500, 0.7, sr));
          return [normalize(d, 0.9)];
        },
      },
      {
        name: '두꺼운 왁스 뽀각 (묵직하게)',
        make(sr) {
          const d = buf(sr, 0.45);
          noiseBurst(d, sr, 0, 1, 0.025, biquad('bp', rnd(700, 1000), 1.1, sr));
          ping(d, sr, 0, 0.6, rnd(130, 170), 0.06, rnd(90, 110));
          crackles(d, sr, 14, 0.32, 0.5, biquad('bp', 1600, 0.9, sr));
          return [normalize(d, 0.95)];
        },
      },
      {
        name: '과자 와사삭 (길게 바스락)',
        make(sr) {
          const d = buf(sr, 0.45);
          const n = 45 + Math.floor(Math.random() * 25);
          for (let k = 0; k < n; k++) {
            const t0 = Math.random() ** 1.5 * 0.3;
            noiseBurst(d, sr, t0, rnd(0.3, 1) * (1 - t0 * 2), rnd(0.002, 0.004), biquad('bp', rnd(2000, 5000), 1.5, sr));
          }
          return [normalize(d, 0.9)];
        },
      },
      {
        name: '얼음 쩍 (날카롭게 갈라짐)',
        make(sr) {
          const d = buf(sr, 0.45);
          noiseBurst(d, sr, 0, 1, 0.0015, biquad('hp', 6000, 0.7, sr));
          ping(d, sr, 0.002, 0.45, rnd(1200, 1600), 0.12, rnd(250, 350), 0.4);
          crackles(d, sr, 5, 0.2, 0.35, biquad('hp', 2500, 0.7, sr));
          return [normalize(d, 0.9)];
        },
      },
    ],
  },

  tick: {
    title: '파편이 바닥에 떨어지는 소리',
    list: [
      {
        name: '틱 (지금 소리)',
        make(sr) {
          const d = buf(sr, 0.08);
          const n = 1 + Math.floor(Math.random() * 3);
          for (let k = 0; k < n; k++) noiseBurst(d, sr, Math.random() * 0.03, rnd(0.5, 1), rnd(0.001, 0.003), biquad('hp', 1500, 0.7, sr));
          return [normalize(d, 0.9)];
        },
      },
      {
        name: '딸깍 (플라스틱)',
        make(sr) {
          const d = buf(sr, 0.1);
          noiseBurst(d, sr, 0, 0.5, 0.001);
          ping(d, sr, 0, 0.8, rnd(1900, 2600), 0.012, undefined, 0.3);
          return [normalize(d, 0.9)];
        },
      },
      {
        name: '사락 (종이처럼 부드럽게)',
        make(sr) {
          const d = buf(sr, 0.12);
          noiseBurst(d, sr, 0, 1, 0.025, biquad('bp', rnd(2500, 4000), 0.8, sr), 0.008);
          return [normalize(d, 0.7)];
        },
      },
      {
        name: '톡 (나무)',
        make(sr) {
          const d = buf(sr, 0.12);
          ping(d, sr, 0, 1, rnd(600, 800), 0.02, undefined, 0.5);
          noiseBurst(d, sr, 0, 0.3, 0.002);
          return [normalize(d, 0.9)];
        },
      },
    ],
  },

  roll: {
    title: '시작할 때 (두구두구… 둥!)',
    list: [
      {
        name: '팀파니 빠른 롤 + 둥 (지금 소리)',
        make(sr) {
          const d = buf(sr, 3.2);
          const end = 2.35;
          for (let t = 0; t < end; t += 1 / 18 + rnd(-0.004, 0.004)) timpani(d, sr, t, (0.12 + 0.55 * (t / end) ** 2) * rnd(0.85, 1.15), 92, 0.25);
          timpani(d, sr, end + 0.08, 1.4, 82, 0.5);
          return [normalize(d, 0.9)];
        },
      },
      {
        name: '팀파니 느린 두구두구 + 둥',
        make(sr) {
          const d = buf(sr, 3.4);
          const end = 2.4;
          let k = 0;
          for (let t = 0; t < end; t += 1 / 9 + rnd(-0.006, 0.006), k++) timpani(d, sr, t, (0.25 + 0.6 * (t / end)) * (k % 2 ? 0.8 : 1), 72, 0.3);
          timpani(d, sr, end + 0.15, 1.5, 62, 0.6);
          return [normalize(d, 0.9)];
        },
      },
      {
        name: '팀파니 롤 + 둥둥!',
        make(sr) {
          const d = buf(sr, 3.6);
          const end = 2.2;
          for (let t = 0; t < end; t += 1 / 16 + rnd(-0.004, 0.004)) timpani(d, sr, t, (0.12 + 0.5 * (t / end) ** 2) * rnd(0.85, 1.15), 95, 0.25);
          timpani(d, sr, end + 0.1, 1.2, 98, 0.35);
          timpani(d, sr, end + 0.45, 1.5, 74, 0.6);
          return [normalize(d, 0.9)];
        },
      },
      {
        name: '스네어 드럼 롤 + 심벌 챙!',
        make(sr) {
          const d = buf(sr, 4.2);
          const end = 2.3;
          for (let t = 0; t < end; t += 1 / 24 + rnd(-0.003, 0.003)) {
            const a = (0.1 + 0.6 * (t / end) ** 1.5) * rnd(0.8, 1.2);
            noiseBurst(d, sr, t, a, 0.035, biquad('bp', 2200, 0.6, sr));
            ping(d, sr, t, a * 0.4, 190, 0.03);
          }
          timpani(d, sr, end + 0.06, 1.0, 70, 0.4);
          // 심벌: 높은 잡음 + 금속성 울림이 길게
          const hp = biquad('hp', 5000, 0.7, sr);
          noiseBurst(d, sr, end + 0.06, 0.9, 0.6, hp);
          for (const f of [3150, 4230, 5370, 6620]) ping(d, sr, end + 0.06, 0.05, f, 0.7);
          return [normalize(d, 0.9)];
        },
      },
    ],
  },

  whistle: {
    title: '글씨가 드러날 때 휘파람',
    list: [
      {
        name: '휘익~ 휘이익 (지금 소리)',
        make(sr) {
          const d = buf(sr, 1.3);
          const glide = (t0, len, a, b, c) => {
            const s0 = Math.floor(t0 * sr);
            let ph = 0;
            for (let i = s0; i < s0 + len * sr && i < d.length; i++) {
              const t = (i - s0) / sr, u = t / len;
              const f = (u < 0.45 ? a * (b / a) ** (u / 0.45) : b * (c / b) ** ((u - 0.45) / 0.55)) + 18 * Math.sin(t * TAU * 7);
              ph += (TAU * f) / sr;
              d[i] += Math.sin(ph) * Math.min(1, t / 0.04) * Math.min(1, (len - t) / 0.08);
            }
          };
          glide(0, 0.32, 900, 2300, 2100);
          glide(0.42, 0.75, 1300, 2700, 950);
          return [normalize(d, 0.6)];
        },
      },
      {
        name: '손가락 휘파람 (높고 길게)',
        make(sr) {
          const d = buf(sr, 1.2);
          const bp = biquad('bp', 3000, 3, sr);
          let ph = 0;
          for (let i = 0; i < d.length; i++) {
            const t = i / sr;
            const f = 2500 + 900 * Math.min(1, t / 0.5) + 25 * Math.sin(t * TAU * 6);
            ph += (TAU * f) / sr;
            const env = Math.min(1, t / 0.06) * Math.min(1, (1.15 - t) / 0.15);
            d[i] += (Math.sin(ph) * 0.85 + bp(Math.random() * 2 - 1) * 0.6) * Math.max(0, env);
          }
          return [normalize(d, 0.55)];
        },
      },
      {
        name: '짧게 휙휙',
        make(sr) {
          const d = buf(sr, 0.7);
          for (const t0 of [0, 0.28]) {
            const s0 = Math.floor(t0 * sr);
            let ph = 0;
            for (let i = s0; i < s0 + 0.2 * sr; i++) {
              const t = (i - s0) / sr;
              const f = 1500 * (2800 / 1500) ** (t / 0.2);
              ph += (TAU * f) / sr;
              d[i] += Math.sin(ph) * Math.min(1, t / 0.02) * Math.min(1, (0.2 - t) / 0.05);
            }
          }
          return [normalize(d, 0.6)];
        },
      },
      {
        name: '호루라기 삐리릭',
        make(sr) {
          const d = buf(sr, 1.0);
          let ph = 0;
          for (let i = 0; i < d.length; i++) {
            const t = i / sr;
            const f = 2900 + 120 * Math.sin(t * TAU * 35);
            ph += (TAU * f) / sr;
            const am = 0.6 + 0.4 * Math.sin(t * TAU * 35);
            const env = Math.min(1, t / 0.02) * Math.min(1, (0.95 - t) / 0.1);
            d[i] += Math.sin(ph) * am * Math.max(0, env) + (Math.random() * 2 - 1) * 0.08 * Math.max(0, env);
          }
          return [normalize(d, 0.5)];
        },
      },
    ],
  },

  cheer: {
    title: '글씨가 드러날 때 환호',
    list: [
      {
        name: '웅성 환호 + 박수 (지금 소리)',
        make(sr) {
          const out = [];
          for (let ch = 0; ch < 2; ch++) {
            const d = buf(sr, 4.5);
            const env = (t) => Math.min(1, t / 0.35) * (t < 2.8 ? 1 : Math.max(0, 1 - (t - 2.8) / 1.7));
            let lp = 0, lp2 = 0;
            for (let i = 0; i < d.length; i++) {
              const t = i / sr;
              const n = Math.random() * 2 - 1;
              lp += (n - lp) * 0.18;
              lp2 += (lp - lp2) * 0.5;
              d[i] += (lp - lp2 * 0.6) * 0.9 * env(t) * (0.75 + 0.25 * Math.sin(t * 5.3 + ch) * Math.sin(t * 2.1));
            }
            for (let k = 0; k < 160; k++) {
              const t = Math.random() * 3.6;
              noiseBurst(d, sr, t, rnd(0.25, 0.75) * env(t), rnd(0.004, 0.01));
            }
            for (let v = 0; v < 5; v++) voice(d, sr, rnd(0, 0.5), rnd(1.4, 3), rnd(170, 430), 0.12);
            out.push(normalize(d, 0.7));
          }
          return out;
        },
      },
      {
        name: '박수만 짝짝짝',
        make(sr) {
          const out = [];
          for (let ch = 0; ch < 2; ch++) {
            const d = buf(sr, 4.2);
            for (let k = 0; k < 220; k++) {
              const t = Math.random() * 3.6;
              const env = Math.min(1, t / 0.25) * (t < 2.6 ? 1 : Math.max(0, 1 - (t - 2.6) / 1.0));
              clap(d, sr, t, rnd(0.4, 1) * env);
            }
            out.push(normalize(d, 0.75));
          }
          return out;
        },
      },
      {
        name: '관객 "와아~" + 박수',
        make(sr) {
          const out = [];
          for (let ch = 0; ch < 2; ch++) {
            const d = buf(sr, 4.5);
            for (let v = 0; v < 14; v++) voice(d, sr, rnd(0, 0.4), rnd(1.6, 3.6), rnd(160, 480), 0.35);
            for (let k = 0; k < 140; k++) {
              const t = rnd(0.3, 3.8);
              clap(d, sr, t, rnd(0.2, 0.5) * Math.max(0, 1 - Math.max(0, t - 2.8) / 1.0));
            }
            out.push(normalize(d, 0.75));
          }
          return out;
        },
      },
      {
        name: '파티 나팔 뿌우~ + 박수',
        make(sr) {
          const out = [];
          for (let ch = 0; ch < 2; ch++) {
            const d = buf(sr, 4.0);
            // 나팔: 거친 톱니파 두 번
            for (const [t0, len] of [[0, 0.35], [0.45, 0.9]]) {
              const s0 = Math.floor(t0 * sr);
              const bp = biquad('bp', 1200, 1, sr);
              let ph = 0;
              for (let i = s0; i < s0 + len * sr; i++) {
                const t = (i - s0) / sr;
                const f = 460 + 25 * Math.sin(t * TAU * 9) + (t < 0.05 ? -100 * (1 - t / 0.05) : 0);
                ph = (ph + f / sr) % 1;
                const env = Math.min(1, t / 0.03) * Math.min(1, (len - t) / 0.06);
                d[i] += bp(ph * 2 - 1) * 2.2 * env;
              }
            }
            for (let k = 0; k < 150; k++) {
              const t = rnd(0.2, 3.5);
              clap(d, sr, t, rnd(0.3, 0.7) * Math.max(0, 1 - Math.max(0, t - 2.6) / 0.9));
            }
            out.push(normalize(d, 0.75));
          }
          return out;
        },
      },
    ],
  },
};

// 채널 배열을 AudioBuffer로
export function toBuffer(ctx, channels) {
  const b = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate);
  channels.forEach((c, i) => b.copyToChannel(c, i));
  return b;
}
