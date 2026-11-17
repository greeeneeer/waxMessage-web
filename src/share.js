// 공용 설정과 링크 인코딩. three.js에 의존하지 않는다 (작성 화면에서도 씀).

// 비누 크기 (3D 단위). 윗면의 평평한 부분에 글씨가 인쇄된다.
export const SOAP = { w: 3.2, h: 1.1, d: 2.2, r: 0.34 };

// 글씨가 들어가는 평평한 윗면의 가로세로
export const LABEL = { w: SOAP.w - 2 * SOAP.r, d: SOAP.d - 2 * SOAP.r };

export const LIMIT = { lines: 2, perLine: 10 };

export const PALETTE = {
  clay: [
    ['#f4b9c6', '딸기'],
    ['#b9e2c4', '민트'],
    ['#ffe08a', '레몬'],
    ['#c4d4ff', '하늘'],
    ['#f3e8d6', '우유'],
  ],
  wax: [
    ['#fbf8f2', '우유빛'],
    ['#ffd3e5', '분홍'],
    ['#d4eeff', '파랑'],
    ['#fff0bd', '노랑'],
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

// 줄 수와 줄당 글자 수 제한을 맞춘다. (이모지도 한 글자로 센다)
export function cleanLines(lines) {
  return lines
    .slice(0, LIMIT.lines)
    .map((l) => Array.from(String(l ?? '').replace(/[\r\n]/g, '')).slice(0, LIMIT.perLine).join(''));
}

export function textOf(lines) {
  const ls = cleanLines(lines);
  while (ls.length && !ls[ls.length - 1].trim()) ls.pop();
  return ls.join('\n');
}

export function encode(data) {
  const o = { t: data.t, f: data.f, c: data.c, w: data.w, k: data.k };
  if (data.o && data.o.trim()) o.o = data.o; // 왁스 겉면 글씨 (있을 때만)
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
    return {
      t,
      o: textOf(String(o.o ?? '').split('\n')),
      f: clampIndex(o.f, FONTS),
      c: clampIndex(o.c, PALETTE.clay),
      w: clampIndex(o.w, PALETTE.wax),
      k: clampIndex(o.k, PALETTE.ink),
    };
  } catch {
    return null;
  }
}
