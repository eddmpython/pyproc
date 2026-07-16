// ps2Set1Text.js - display/input probe 문자를 PS/2 Set 1 press/release bytes로 만든다.
const SCAN_CODES = Object.freeze({
  "1": 2,
  "2": 3,
  "3": 4,
  "4": 5,
  "5": 6,
  "6": 7,
  "7": 8,
  "8": 9,
  "9": 10,
  "0": 11,
  "-": 12,
  q: 16,
  w: 17,
  e: 18,
  r: 19,
  t: 20,
  y: 21,
  u: 22,
  i: 23,
  o: 24,
  p: 25,
  a: 30,
  s: 31,
  d: 32,
  f: 33,
  g: 34,
  h: 35,
  j: 36,
  k: 37,
  l: 38,
  z: 44,
  x: 45,
  c: 46,
  v: 47,
  b: 48,
  n: 49,
  m: 50,
  ".": 52,
  "/": 53,
  " ": 57,
  "\n": 28,
});

export function encodePs2Set1Text(value) {
  const codes = [];
  for (const character of String(value)) {
    const scanCode = SCAN_CODES[character];
    if (!scanCode) throw new TypeError(`PS/2 probe 문자 미지원: ${JSON.stringify(character)}`);
    codes.push(scanCode, scanCode | 0x80);
  }
  return Uint8Array.from(codes);
}
