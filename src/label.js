// 비누 윗면에 인쇄된 글씨를 캔버스에 그린다. (작성 화면 미리보기와 3D 텍스처가 같이 씀)
import { FONTS, PALETTE } from './share.js';

// 웹 글꼴이 내려받아질 때까지 기다린다. 너무 오래 걸리면 그냥 진행.
// (한글 웹 글꼴은 글자 묶음별로 나눠 내려받기 때문에, 쓰는 글자를 text로 꼭 넘겨야 그 글자가 들어 있는 묶음을 받는다)
export async function ensureFont(f, text, timeout = 3000) {
  const [family, weight] = FONTS[f];
  try {
    await Promise.race([
      document.fonts.load(`${weight} 64px "${family}"`, text || '가나다'),
      new Promise((r) => setTimeout(r, timeout)),
    ]);
  } catch {
    /* 글꼴을 못 받아도 기본 글꼴로 그린다 */
  }
}

// 글꼴 묶음이 늦게 도착했을 때 다시 그리도록 cb를 부른다 (안 그러면 일부 글자만 기본 글꼴로 남아 섞여 보인다)
export function onFontsLoaded(cb) {
  document.fonts?.addEventListener?.('loadingdone', cb);
}

// 문단(줄바꿈으로 나뉜 덩어리)을 너비 maxW에 맞게 줄을 나눈다. 띄어쓰기에서 먼저 나누고, 한 단어가 너무 길면 글자 단위로.
function wrap(ctx, paragraphs, maxW, charBreak = true) {
  const out = [];
  for (const para of paragraphs) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (ctx.measureText(cand).width <= maxW) { line = cand; continue; }
      if (line) out.push(line);
      line = '';
      if (!charBreak) { line = w; continue; }
      // 단어 하나가 한 줄보다 길면 글자 단위로 자른다
      for (const ch of Array.from(w)) {
        if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; }
        else line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

// 투명 배경 위에 글씨만 그린다. 인쇄 느낌을 위해 잉크에 작은 빈틈을 뿌린다.
// 글이 길면 자연스럽게 줄을 바꾸고, 영역에 다 들어가는 가장 큰 크기로 쓴다.
// fitTexts: 여러 글씨를 같은 크기로 쓰고 싶을 때, 그중 가장 긴 것에 맞춘 크기를 쓴다 (버튼용, 줄바꿈 없음)
export function drawLabel(ctx, W, H, data, { placeholder = '', fitTexts = null, pad = 0.07, maxH = 0.62 } = {}) {
  ctx.clearRect(0, 0, W, H);
  const empty = !data.t.trim();
  const text = empty ? placeholder : data.t;
  if (!text) return;

  const [family, weight] = FONTS[data.f];
  const paragraphs = text.split('\n');
  const padX = W * pad;
  const padY = H * pad * 1.4;
  const availW = W - padX * 2;
  const availH = H - padY * 2;
  const lh = 1.18;
  const setSize = (sz) => (ctx.font = `${weight} ${sz}px "${family}", sans-serif`);

  let size, lines;
  if (fitTexts) {
    lines = paragraphs;
    size = Math.min(availH / (lines.length * lh), availH * maxH);
    setSize(size);
    const widest = Math.max(...fitTexts.map((l) => ctx.measureText(l).width), 1);
    if (widest > availW) size *= availW / widest;
  } else {
    // 다 들어가는 가장 큰 글씨 크기를 찾는다
    const best = (charBreak) => {
      let lo = 4, hi = availH * maxH;
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        setSize(mid);
        const ls = wrap(ctx, paragraphs, availW, charBreak);
        const fits = ls.length * mid * lh <= availH && Math.max(...ls.map((l) => ctx.measureText(l).width)) <= availW;
        if (fits) lo = mid; else hi = mid;
      }
      return lo;
    };
    // 단어 중간을 자르는 건 그래야 글씨가 훨씬 커질 때만 (띄어쓰기 없는 긴 글)
    const byWords = best(false);
    const byChars = best(true);
    const charBreak = byChars > byWords * 1.6;
    size = charBreak ? byChars : byWords;
    setSize(size);
    lines = wrap(ctx, paragraphs, availW, charBreak);
  }
  setSize(size);

  ctx.save();
  ctx.fillStyle = PALETTE.ink[data.k][0];
  ctx.globalAlpha = empty ? 0.3 : 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    const y = H / 2 + (i - (lines.length - 1) / 2) * size * lh + size * 0.04;
    ctx.fillText(l, W / 2, y);
  });

  // 인쇄 자국: 잉크를 군데군데 살짝 덜어낸다
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 1;
  const dots = Math.round((W * H) / 260);
  for (let i = 0; i < dots; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.12 + Math.random() * 0.3})`;
    const r = 0.6 + Math.random() * (W / 700);
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
