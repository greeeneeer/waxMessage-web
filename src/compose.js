// 작성 화면: 숨길 글씨, 왁스 겹(색·겉면 글씨), 글꼴·색을 고르고 보낼 링크를 만든다.
import { PALETTE, FONTS, SOAP, MAX_LAYERS, encode, cleanText } from './share.js';
import { drawLabel, ensureFont, onFontsLoaded } from './label.js';

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

// 보낼 링크의 앞부분. 내 컴퓨터(localhost)에서 만들어도 다른 사람이 열 수 있게 공개 주소로 만든다.
const PUBLIC_URL = 'https://greeeneeer.github.io/wax-soap-web/';
function linkBase() {
  const local = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);
  return local ? PUBLIC_URL : `${location.origin}${location.pathname}`;
}

const layerName = (i) => (i === 0 ? '겉 왁스' : `속 왁스 ${i}`);

export function startCompose() {
  const d = loadDraft() || {};
  const pick = (v, list) => (Number.isInteger(v) && v >= 0 && v < list.length ? v : 0);
  // 예전 초안(겹 하나: w, outer)도 읽는다
  const draftLayers = Array.isArray(d.layers) && d.layers.length ? d.layers : [{ w: d.w, lines: d.outer }];
  const state = {
    // 숨길 글씨 (예전 초안은 두 줄 lines였다 → 한 글로 합친다)
    text: typeof d.text === 'string' ? d.text : (d.lines || []).filter(Boolean).join('\n'),
    // 예전 초안은 겹 글씨가 두 줄(lines)이었다 → 한 글로 합친다
    layers: draftLayers.slice(0, MAX_LAYERS).map((l) => ({
      w: pick(l.w, PALETTE.wax),
      k: pick(l.k ?? d.k, PALETTE.ink),
      text: typeof l.text === 'string' ? l.text : (l.lines || []).filter(Boolean).join('\n'),
    })),
    f: pick(d.f, FONTS),
    c: pick(d.c, PALETTE.clay),
    k: pick(d.k, PALETTE.ink),
  };

  // 글이 길어지면 칸도 따라 늘어나는 글씨 칸
  function bindText(ta, get, set) {
    ta.value = get();
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
    ta.addEventListener('input', () => { set(ta.value); grow(); update(); });
    requestAnimationFrame(grow);
  }

  // 숨길 글씨
  bindText($('clayText'), () => state.text, (v) => (state.text = v));

  // 왁스 겹 카드들
  function renderLayers() {
    const box = $('layers');
    box.textContent = '';
    state.layers.forEach((layer, i) => {
      const card = document.createElement('div');
      card.className = 'layer-card';
      card.innerHTML = `
        <div class="layer-head"><b></b></div>
        <textarea class="text" rows="2" autocomplete="off"></textarea>
        <div class="sub">글씨 색</div>
        <div class="swatches ink"></div>
        <div class="sub">왁스 색</div>
        <div class="swatches wax"></div>`;
      card.querySelector('b').textContent = layerName(i);
      bindText(card.querySelector('textarea'), () => layer.text, (v) => (layer.text = v));

      const inkBox = card.querySelector('.ink');
      PALETTE.ink.forEach(([color, name], j) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.style.background = color;
        b.title = name;
        b.setAttribute('aria-label', `${layerName(i)} 글씨 ${name}`);
        b.addEventListener('click', () => { layer.k = j; mark(inkBox, j); update(); });
        inkBox.append(b);
      });
      mark(inkBox, layer.k);

      if (i > 0) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'ghost';
        rm.textContent = '빼기';
        rm.addEventListener('click', () => { state.layers.splice(i, 1); renderLayers(); update(); });
        card.querySelector('.layer-head').append(rm);
      }

      const sw = card.querySelector('.wax');
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
    state.layers.push({ w: (prev + 1) % PALETTE.wax.length, k: state.layers[state.layers.length - 1].k, text: '' });
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
      toast('복사 완료');
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
      ...data.layers.map((l, i) => [PALETTE.wax[l.w][0], { ...data, t: l.o, k: l.k }, layerName(i), i === 0 ? '겉면 글씨' : '']),
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

  onFontsLoaded(() => drawPreviews());

  function currentData() {
    return {
      t: cleanText(state.text),
      layers: state.layers.map((l) => ({ w: l.w, k: l.k, o: cleanText(l.text) })),
      f: state.f, c: state.c, k: state.k,
    };
  }

  function update() {
    saveDraft({ text: state.text, layers: state.layers.map((l) => ({ w: l.w, k: l.k, text: l.text })), f: state.f, c: state.c, k: state.k });
    const data = currentData();
    const ok = !!data.t.trim();
    $('link').value = ok ? `${linkBase()}#${encode(data)}` : '';
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
