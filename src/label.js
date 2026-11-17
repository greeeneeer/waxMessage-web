// 비누 윗면에 인쇄된 글씨를 캔버스에 그린다. (작성 화면 미리보기와 3D 텍스처가 같이 씀)
import { FONTS, PALETTE } from './share.js';

// 웹 글꼴이 내려받아질 때까지 기다린다. 너무 오래 걸리면 그냥 진행.
export async function ensureFont(f, text) {
  const [family, weight] = FONTS[f];
  try {
    await Promise.race([
      document.fonts.load(`${weight} 64px "${family}"`, text || '가나다'),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch {
    /* 글꼴을 못 받아도 기본 글꼴로 그린다 */
  }
}

// 투명 배경 위에 글씨만 그린다. 인쇄 느낌을 위해 잉크에 작은 빈틈을 뿌린다.
export function drawLabel(ctx, W, H, data, { placeholder = '' } = {}) {
  ctx.clearRect(0, 0, W, H);
  const empty = !data.t.trim();
  const text = empty ? placeholder : data.t;
  if (!text) return;

  const [family, weight] = FONTS[data.f];
  const lines = text.split('\n');
  const padX = W * 0.07;
  const padY = H * 0.1;
  const availW = W - padX * 2;
  const availH = H - padY * 2;
  const lh = 1.18;

  let size = Math.min(availH / (lines.length * lh), availH * 0.62);
  ctx.font = `${weight} ${size}px "${family}", sans-serif`;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
  if (widest > availW) size *= availW / widest;
  ctx.font = `${weight} ${size}px "${family}", sans-serif`;

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
