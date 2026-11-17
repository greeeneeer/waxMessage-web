// 작성 화면: 글씨와 색을 고르고 보낼 링크를 만든다.
import { PALETTE, FONTS, SOAP, LIMIT, encode, cleanLines, textOf } from './share.js';
import { drawLabel, ensureFont } from './label.js';

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'wax-soap-draft';

function loadDraft() {
  try {
    const o = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (o && typeof o === 'object') return o;
  } catch { /* 저장소를 못 쓰면 새로 시작 */ }
  return null;
}
function saveDraft(s) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(s)); } catch { /* 무시 */ }
}

export function startCompose() {
  const d = loadDraft() || {};
  const pick = (v, list) => (Number.isInteger(v) && v >= 0 && v < list.length ? v : 0);
  const state = {
    lines: cleanLines([d.lines?.[0] ?? '', d.lines?.[1] ?? '']),
    f: pick(d.f, FONTS),
    c: pick(d.c, PALETTE.clay),
    w: pick(d.w, PALETTE.wax),
    k: pick(d.k, PALETTE.ink),
  };

  const inputs = [$('l1'), $('l2')];
  const counts = [$('n1'), $('n2')];
  inputs.forEach((el, i) => {
    el.value = state.lines[i];
    el.addEventListener('input', () => {
      // 한글 조합 중에는 건드리지 않는다
      if (!el.dataset.composing) {
        const clean = cleanLines([el.value])[0];
        if (clean !== el.value) el.value = clean;
      }
      state.lines[i] = el.value;
      update();
    });
    el.addEventListener('compositionstart', () => (el.dataset.composing = '1'));
    el.addEventListener('compositionend', () => {
      delete el.dataset.composing;
      el.dispatchEvent(new Event('input'));
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        if (i === 0) inputs[1].focus();
        else el.blur();
      }
    });
  });

  // 글꼴 버튼
  const fontBox = $('fonts');
  FONTS.forEach(([family, weight, name], i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.style.fontFamily = `"${family}"`;
    b.style.fontWeight = weight;
    b.addEventListener('click', () => { state.f = i; mark(fontBox, i); update(); });
    fontBox.append(b);
  });
  mark(fontBox, state.f);

  // 색 버튼들
  swatches($('inks'), PALETTE.ink, 'k');
  swatches($('clays'), PALETTE.clay, 'c');
  swatches($('waxes'), PALETTE.wax, 'w');

  function swatches(box, list, key) {
    list.forEach(([color, name], i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = color;
      b.title = name;
      b.setAttribute('aria-label', name);
      b.addEventListener('click', () => { state[key] = i; mark(box, i); update(); });
      box.append(b);
    });
    mark(box, state[key]);
  }

  // 버튼 동작
  const toast = (msg) => {
    $('toast').textContent = msg;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => ($('toast').textContent = ''), 2200);
  };

  $('copy').addEventListener('click', async () => {
    const link = $('link').value;
    try {
      await navigator.clipboard.writeText(link);
      toast('링크를 복사했어요! 보내고 싶은 사람에게 붙여 넣으세요');
    } catch {
      $('link').select();
      toast('위 링크를 길게 눌러 복사해 주세요');
    }
  });

  if (navigator.share) {
    $('share').hidden = false;
    $('share').addEventListener('click', () => {
      navigator.share({ title: '왁뿌 비누', text: '왁스를 깨면 글씨가 나와요', url: $('link').value }).catch(() => {});
    });
  }

  $('try').addEventListener('click', () => {
    location.hash = $('link').value.split('#')[1];
  });

  // 미리보기와 링크 갱신
  let drawToken = 0;
  async function drawPreview() {
    const token = ++drawToken;
    const data = currentData();
    await ensureFont(data.f, data.t);
    if (token !== drawToken) return;

    const cv = $('preview');
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);

    // 비누 (위에서 본 모습)
    const pad = 24;
    const w = W - pad * 2;
    const h = w * (SOAP.d / SOAP.w);
    const x = pad;
    const y = (H - h) / 2;
    const r = w * (SOAP.r / SOAP.w) * 1.4;
    const clay = PALETTE.clay[data.c][0];

    ctx.save();
    ctx.shadowColor = 'rgba(80, 40, 30, 0.22)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 10;
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = clay;
    ctx.fill();
    ctx.restore();

    const g = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.08)');
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = g;
    ctx.fill();

    // 글씨
    const lw = w * (1 - (2 * SOAP.r) / SOAP.w);
    const lh = h * (1 - (2 * SOAP.r) / SOAP.d);
    const lc = document.createElement('canvas');
    lc.width = 1024;
    lc.height = Math.round((1024 * lh) / lw);
    drawLabel(lc.getContext('2d'), lc.width, lc.height, data, { placeholder: '여기에 글씨가\n보여요' });
    ctx.drawImage(lc, x + (w - lw) / 2, y + (h - lh) / 2, lw, lh);
  }

  function currentData() {
    return { t: textOf(state.lines), f: state.f, c: state.c, w: state.w, k: state.k };
  }

  function update() {
    saveDraft(state);
    state.lines.forEach((l, i) => (counts[i].textContent = `${Array.from(l).length}/${LIMIT.perLine}`));
    const data = currentData();
    const ok = !!data.t.trim();
    $('link').value = ok ? `${location.origin}${location.pathname}#${encode(data)}` : '';
    $('link').placeholder = '글씨를 쓰면 보낼 링크가 생겨요';
    ['copy', 'share', 'try'].forEach((id) => ($(id).disabled = !ok));
    drawPreview();
  }

  update();
}

function mark(box, i) {
  [...box.children].forEach((b, j) => b.classList.toggle('on', i === j));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
