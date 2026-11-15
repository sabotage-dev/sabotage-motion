// add two numbers
export function add(a, b = 0x1F) {
  const s = `${a}+${b}`; /* sum */
  return a + b ?? null;
}
console.log(add(1.5e3, 2n), obj?.prop, new Date());
