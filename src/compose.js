// 작성 화면: 숨길 글씨, 왁스 겹(색·겉면 글씨), 글꼴·색을 고르고 보낼 링크를 만든다.
import { PALETTE, FONTS, SOAP, MAX_LAYERS, encode, cleanLines, textOf } from './share.js';
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

const layerName = (i) => (i === 0 ? '겉 왁스' : `속 왁스 ${i}`);

export function startCompose() {
  const d = loadDraft() || {};
  const pick = (v, list) => (Number.isInteger(v) && v >= 0 && v < list.length ? v : 0);
  // 예전 초안(겹 하나: w, outer)도 읽는다
  const draftLayers = Array.isArray(d.layers) && d.layers.length ? d.layers : [{ w: d.w, lines: d.outer }];
  const state = {
    lines: cleanLines([d.lines?.[0] ?? '', d.lines?.[1] ?? '']),
    layers: draftLayers.slice(0, MAX_LAYERS).map((l) => ({
      w: pick(l.w, PALETTE.wax),
      lines: cleanLines([l.lines?.[0] ?? '', l.lines?.[1] ?? '']),
    })),
    f: pick(d.f, FONTS),
    c: pick(d.c, PALETTE.clay),
    k: pick(d.k, PALETTE.ink),
  };

  // 숨길 글씨
  bindLines([$('l1'), $('l2')], state.lines);

  // 두 줄 입력칸을 상태에 연결한다
  function bindLines(inputs, target) {
    inputs.forEach((el, i) => {
      el.value = target[i];
      el.addEventListener('input', () => {
        // 한글 조합 중에는 건드리지 않는다
        if (!el.dataset.composing) {
          const clean = cleanLines([el.value])[0];
          if (clean !== el.value) el.value = clean;
        }
        target[i] = el.value;
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
  }

  // 왁스 겹 카드들
  function renderLayers() {
    const box = $('layers');
    box.textContent = '';
    state.layers.forEach((layer, i) => {
      const card = document.createElement('div');
      card.className = 'layer-card';
      card.innerHTML = `
        <div class="layer-head"><b></b></div>
        <div class="line"><input type="text" autocomplete="off" /></div>
        <div class="line"><input type="text" autocomplete="off" placeholder="둘째 줄" /></div>
        <div class="swatches"></div>`;
      card.querySelector('b').textContent = layerName(i);
      const inputs = [...card.querySelectorAll('input')];
      inputs[0].placeholder = '첫째 줄';
      bindLines(inputs, layer.lines);

      if (i > 0) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'ghost';
        rm.textContent = '빼기';
        rm.addEventListener('click', () => { state.layers.splice(i, 1); renderLayers(); update(); });
        card.querySelector('.layer-head').append(rm);
      }

      const sw = card.querySelector('.swatches');
      PALETTE.wax.forEach(([color, name], j) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.style.background = color;
        b.title = name;
        b.setAttribute('aria-label', `${layerName(i)} ${name}`);
        b.addEventListener('click', () => { layer.w = j; mark(sw, j); update(); });
        sw.append(b);
      });
      mark(sw, layer.w);
      box.append(card);
    });
    $('addLayer').hidden = state.layers.length >= MAX_LAYERS;
  }
  $('addLayer').addEventListener('click', () => {
    if (state.layers.length >= MAX_LAYERS) return;
    // 바로 바깥 겹과 다른 색으로
    const prev = state.layers[state.layers.length - 1].w;
    state.layers.push({ w: (prev + 1) % PALETTE.wax.length, lines: ['', ''] });
    renderLayers();
    update();
  });
  renderLayers();

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

  swatches($('inks'), PALETTE.ink, 'k');
  swatches($('clays'), PALETTE.clay, 'c');
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
      navigator.share({ title: '메세지 왁뿌', text: '왁스를 깨면 글씨가 나와요', url: $('link').value }).catch(() => {});
    });
  }
  $('try').addEventListener('click', () => {
    location.hash = $('link').value.split('#')[1];
  });

  // 미리보기: 겹마다 하나씩 + 클레이
  let drawToken = 0;
  async function drawPreviews() {
    const token = ++drawToken;
    const data = currentData();
    await ensureFont(data.f, data.t + data.layers.map((l) => l.o).join(''));
    if (token !== drawToken) return;
    const box = $('previews');
    const items = [
      ...data.layers.map((l, i) => [PALETTE.wax[l.w][0], { ...data, t: l.o }, layerName(i), i === 0 ? '겉면 글씨' : '']),
      [PALETTE.clay[data.c][0], data, '클레이', '숨길 글씨'],
    ];
    box.textContent = '';
    for (const [color, d2, caption, placeholder] of items) {
      const fig = document.createElement('figure');
      const cv = document.createElement('canvas');
      cv.width = 480;
      cv.height = 340;
      drawSoapTop(cv, color, d2, placeholder);
      const cap = document.createElement('figcaption');
      cap.textContent = caption;
      fig.append(cv, cap);
      box.append(fig);
    }
  }

  function currentData() {
    return {
      t: textOf(state.lines),
      layers: state.layers.map((l) => ({ w: l.w, o: textOf(l.lines) })),
      f: state.f, c: state.c, k: state.k,
    };
  }

  function update() {
    saveDraft({ lines: [...state.lines], layers: state.layers.map((l) => ({ w: l.w, lines: [...l.lines] })), f: state.f, c: state.c, k: state.k });
    const data = currentData();
    const ok = !!data.t.trim();
    $('link').value = ok ? `${location.origin}${location.pathname}#${encode(data)}` : '';
    $('link').placeholder = '';
    ['copy', 'share', 'try'].forEach((id) => ($(id).disabled = !ok));
    drawPreviews();
  }

  update();
}

// 위에서 본 비누 한 면 + 인쇄된 글씨
function drawSoapTop(cv, color, data, placeholder) {
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  ctx.clearRect(0, 0, W, H);

  const pad = 18;
  const w = W - pad * 2;
  const h = w * (SOAP.d / SOAP.w);
  const x = pad;
  const y = (H - h) / 2;
  const r = w * (SOAP.r / SOAP.w) * 1.4;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  const g = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.08)');
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = g;
  ctx.fill();

  const lw = w * (1 - (2 * SOAP.r) / SOAP.w);
  const lh = h * (1 - (2 * SOAP.r) / SOAP.d);
  const lc = document.createElement('canvas');
  lc.width = 1024;
  lc.height = Math.round((1024 * lh) / lw);
  drawLabel(lc.getContext('2d'), lc.width, lc.height, data, { placeholder });
  ctx.drawImage(lc, x + (w - lw) / 2, y + (h - lh) / 2, lw, lh);
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
