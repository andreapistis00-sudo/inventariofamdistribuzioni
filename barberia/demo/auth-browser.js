// Solo per la demo: hash semplice e sincrono (il server vero usa scrypt).
function h(s) {
  let a = 0x811c9dc5, b = 0x1234567;
  for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 16777619); b = Math.imul(b ^ s.charCodeAt(i), 2246822507); }
  return (a >>> 0).toString(16) + (b >>> 0).toString(16);
}
export const hashPassword = (p) => `demo:${h('barberia' + p)}`;
export const verifyPassword = (p, stored) => stored === hashPassword(p);
export function newToken() {
  const a = new Uint8Array(24); crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
}
