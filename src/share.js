// 공용 설정과 링크 인코딩. three.js에 의존하지 않는다 (작성 화면에서도 씀).

// 비누 크기 (3D 단위). 윗면의 평평한 부분에 글씨가 인쇄된다.
export const SOAP = { w: 3.2, h: 1.1, d: 2.2, r: 0.34 };

// 글씨가 들어가는 평평한 윗면의 가로세로
export const LABEL = { w: SOAP.w - 2 * SOAP.r, d: SOAP.d - 2 * SOAP.r };

export const LIMIT = { lines: 2 };
export const MAX_LAYERS = 3; // 왁스는 최대 세 겹

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

// 두 줄까지만 남긴다
export function cleanLines(lines) {
  return lines
    .slice(0, LIMIT.lines)
    .map((l) => String(l ?? '').replace(/[\r\n]/g, '')); // 글자 수 제한 없음: 길면 글씨가 작아진다
}

// 왁스 글씨: 글자 수·줄 수 제한 없이 하나의 글. 끝의 빈칸·빈 줄만 지운다
export function cleanText(v) {
  return String(v ?? '').replace(/\r/g, '').replace(/\s+$/, '');
}

export function textOf(lines) {
  const ls = cleanLines(lines);
  while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
  return ls.join('\n');
}

// data.layers: 왁스 겹 목록, 바깥부터. [{ w: 왁스 색, o: 그 겹 겉면 글씨, k: 그 겹 글씨 색 }]
// data.k는 클레이(숨길 글씨) 글씨 색.
// 링크에는 첫 겹을 예전 형식(w, o, ok)으로, 안쪽 겹들은 L: [[색, 글씨, 글씨 색], ...]로 넣는다 (예전 링크와 호환)
export function encode(data) {
  const [first, ...rest] = data.layers;
  const o = { t: data.t, f: data.f, c: data.c, w: first.w, k: data.k, ok: first.k };
  if (first.o && first.o.trim()) o.o = first.o;
  if (rest.length) o.L = rest.map((l) => [l.w, l.o || '', l.k]);
  const json = JSON.stringify(o);
  let bin = '';
  new TextEncoder().encode(json).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 잘못된 링크면 null
export function decode(code) {
  if (!code) return null;
  try {
    let s = code.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const o = JSON.parse(new TextDecoder().decode(bytes));
    const t = textOf(String(o.t ?? '').split('\n'));
    if (!t.trim()) return null;
    const k = clampIndex(o.k, PALETTE.ink);
    const ink = (v) => (Number.isInteger(v) ? clampIndex(v, PALETTE.ink) : k);
    const layers = [{ w: clampIndex(o.w, PALETTE.wax), o: cleanText(o.o), k: ink(o.ok) }];
    if (Array.isArray(o.L)) {
      for (const l of o.L.slice(0, MAX_LAYERS - 1)) {
        if (Array.isArray(l)) layers.push({ w: clampIndex(l[0], PALETTE.wax), o: cleanText(l[1]), k: ink(l[2]) });
      }
    }
    return {
      t,
      layers,
      f: clampIndex(o.f, FONTS),
      c: clampIndex(o.c, PALETTE.clay),
      k,
    };
  } catch {
    return null;
  }
}
