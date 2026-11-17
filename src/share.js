// 공용 설정과 링크 인코딩. three.js에 의존하지 않는다 (작성 화면에서도 씀).

// 비누 크기 (3D 단위). 윗면의 평평한 부분에 글씨가 인쇄된다.
export const SOAP = { w: 3.2, h: 1.1, d: 2.2, r: 0.34 };

// 글씨가 들어가는 평평한 윗면의 가로세로
export const LABEL = { w: SOAP.w - 2 * SOAP.r, d: SOAP.d - 2 * SOAP.r };

export const MAX_LAYERS = 5; // 왁스는 최대 다섯 겹

export const PALETTE = {
  clay: [
    ['#f4b9c6', '딸기'],
    ['#b9e2c4', '민트'],
    ['#ffe08a', '레몬'],
    ['#c4d4ff', '하늘'],
    ['#f3e8d6', '우유'],
    ['#ff9e80', '복숭아'],
    ['#ffb347', '오렌지'],
    ['#d7b8f3', '라벤더'],
    ['#9ad3de', '청록'],
    ['#a8d672', '라임'],
    ['#c49a6c', '캐러멜'],
    ['#8d6e63', '코코아'],
    ['#f06292', '체리'],
    ['#7986cb', '블루베리'],
    ['#4f4f5a', '먹물'],
  ],
  wax: [
    ['#fbf8f2', '우유빛'],
    ['#ffd3e5', '분홍'],
    ['#d4eeff', '파랑'],
    ['#fff0bd', '노랑'],
    ['#ffffff', '하양'],
    ['#e9e4dc', '회색빛'],
    ['#ffd8b8', '살구'],
    ['#e3d4ff', '연보라'],
    ['#d2f5e3', '민트'],
    ['#f7c6c7', '장밋빛'],
    ['#c8e6ff', '하늘'],
    ['#f5e1a4', '꿀'],
    ['#2b2b30', '검정'],
    ['#b8c0c8', '은빛'],
  ],
  ink: [
    ['#3a2826', '초코'],
    ['#e0405a', '빨강'],
    ['#2c66cf', '파랑'],
    ['#ffffff', '하양'],
  ],
};

// [CSS 글꼴 이름, 굵기, 화면에 보일 이름]
export const FONTS = [
  ['Noto Sans KR', 800, '고딕'],
  ['Black Han Sans', 400, '굵은 고딕'],
  ['Gothic A1', 600, '가는 고딕'],
  ['Noto Serif KR', 700, '명조'],
  ['Song Myung', 400, '옛 명조'],
  ['Do Hyeon', 400, '도톰'],
  ['Jua', 400, '동글'],
  ['Gaegu', 700, '손글씨'],
  ['Nanum Pen Script', 400, '펜글씨'],
  ['Yeon Sung', 400, '붓글씨'],
];

const clampIndex = (v, list) => (Number.isInteger(v) && v >= 0 && v < list.length ? v : 0);

// 글씨(클레이·왁스 모두): 글자 수·줄 수 제한 없이 하나의 글. 끝의 빈칸·빈 줄만 지운다
export function cleanText(v) {
  return String(v ?? '').replace(/\r/g, '').replace(/\s+$/, '');
}

// data.layers: 왁스 겹 목록, 바깥부터. [{ w: 왁스 색, o: 그 겹 겉면 글씨, k: 그 겹 글씨 색 }]
// data.k는 클레이(숨길 글씨) 글씨 색.
//
// 링크 형식 (짧게 만들려고 비트 단위로 촘촘히 담는다):
//   버전 2비트(11) · 글꼴·클레이 색·클레이 글씨 색 각 5비트 · 겹 수-1 3비트 · 클레이 글씨
//   (버전 10은 겹 수-1이 2비트였던 예전 형식. 읽기만 한다)
//   · 겹마다 [왁스 색 5비트 · 글씨 색 5비트 · 글씨]
//   글씨 한 글자: 한글 음절 = 0 + 14비트(가~힣 순번) / 영문·숫자·기호 = 10 + 7비트 / 그 밖 = 11 + 21비트.
//   글 끝 = 10 + 0000000.
// 이렇게 만든 바이트를 base64url로 바꿔 # 뒤에 붙인다. 첫 글자는 항상 g~z/0~9/-/_ 중 하나라
// 예전 형식(JSON을 base64로, 항상 'eyJ'로 시작)과 겹치지 않는다.
const HANGUL0 = 0xac00, HANGUL_N = 11172;

class BitWriter {
  bytes = [];
  cur = 0;
  n = 0;
  put(v, bits) {
    for (let i = bits - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((v >> i) & 1);
      if (++this.n === 8) { this.bytes.push(this.cur); this.cur = 0; this.n = 0; }
    }
  }
  text(str) {
    for (const ch of Array.from(str)) {
      const cp = ch.codePointAt(0);
      if (cp >= HANGUL0 && cp < HANGUL0 + HANGUL_N) { this.put(0, 1); this.put(cp - HANGUL0, 14); }
      else if (cp > 0 && cp < 128) { this.put(0b10, 2); this.put(cp, 7); }
      else { this.put(0b11, 2); this.put(cp, 21); }
    }
    this.put(0b10, 2); this.put(0, 7); // 글 끝
  }
  done() {
    if (this.n) this.bytes.push(this.cur << (8 - this.n));
    return Uint8Array.from(this.bytes);
  }
}

class BitReader {
  constructor(bytes) { this.bytes = bytes; this.pos = 0; }
  get(bits) {
    let v = 0;
    for (let i = 0; i < bits; i++) {
      const byte = this.bytes[this.pos >> 3];
      if (byte === undefined) throw new Error('짧은 링크');
      v = (v << 1) | ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
  text() {
    let out = '';
    for (let guard = 0; guard < 100000; guard++) {
      if (this.get(1) === 0) { out += String.fromCodePoint(HANGUL0 + Math.min(this.get(14), HANGUL_N - 1)); continue; }
      if (this.get(1) === 0) {
        const c = this.get(7);
        if (c === 0) return out;
        out += String.fromCharCode(c);
      } else {
        out += String.fromCodePoint(Math.min(this.get(21), 0x10ffff));
      }
    }
    throw new Error('글이 끝나지 않음');
  }
}

const toB64url = (bytes) => {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (code) => {
  let s = code.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
};

export function encode(data) {
  const w = new BitWriter();
  w.put(0b11, 2); // 버전
  w.put(data.f, 5);
  w.put(data.c, 5);
  w.put(data.k, 5);
  const layers = data.layers.slice(0, MAX_LAYERS);
  w.put(layers.length - 1, 3);
  w.text(cleanText(data.t));
  for (const l of layers) {
    w.put(l.w, 5);
    w.put(l.k ?? data.k, 5);
    w.text(cleanText(l.o));
  }
  return toB64url(w.done());
}

// 잘못된 링크면 null. 예전 형식(JSON) 링크도 읽는다.
export function decode(code) {
  if (!code) return null;
  try {
    const data = code.startsWith('eyJ') ? decodeOld(code) : decodeBits(code);
    return data && data.t.trim() ? data : null;
  } catch {
    return null;
  }
}

function decodeBits(code) {
  const r = new BitReader(fromB64url(code));
  const ver = r.get(2);
  if (ver !== 0b10 && ver !== 0b11) return null;
  const f = clampIndex(r.get(5), FONTS);
  const c = clampIndex(r.get(5), PALETTE.clay);
  const k = clampIndex(r.get(5), PALETTE.ink);
  const n = Math.min(r.get(ver === 0b11 ? 3 : 2) + 1, MAX_LAYERS);
  const t = cleanText(r.text());
  const layers = [];
  for (let i = 0; i < n; i++) {
    const lw = clampIndex(r.get(5), PALETTE.wax);
    const lk = clampIndex(r.get(5), PALETTE.ink);
    layers.push({ w: lw, k: lk, o: cleanText(r.text()) });
  }
  return { t, layers, f, c, k };
}

// 예전 형식: JSON { t, f, c, w, k, ok, o, L: [[색, 글씨, 글씨 색], ...] }을 base64url로
function decodeOld(code) {
  const o = JSON.parse(new TextDecoder().decode(fromB64url(code)));
  const k = clampIndex(o.k, PALETTE.ink);
  const ink = (v) => (Number.isInteger(v) ? clampIndex(v, PALETTE.ink) : k);
  const layers = [{ w: clampIndex(o.w, PALETTE.wax), o: cleanText(o.o), k: ink(o.ok) }];
  if (Array.isArray(o.L)) {
    for (const l of o.L.slice(0, MAX_LAYERS - 1)) {
      if (Array.isArray(l)) layers.push({ w: clampIndex(l[0], PALETTE.wax), o: cleanText(l[1]), k: ink(l[2]) });
    }
  }
  return {
    t: cleanText(o.t),
    layers,
    f: clampIndex(o.f, FONTS),
    c: clampIndex(o.c, PALETTE.clay),
    k,
  };
}
