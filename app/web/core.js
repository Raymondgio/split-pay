// Loads the Rust money core (WebAssembly) and exposes two functions.
let wasm = null;
const enc = new TextEncoder();
const dec = new TextDecoder();

export async function loadCore() {
  const bytes = await (await fetch('core.wasm')).arrayBuffer();
  wasm = (await WebAssembly.instantiate(bytes, {})).instance.exports;
}

function call(op, obj) {
  const input = enc.encode(JSON.stringify(obj));
  const inPtr = wasm.sp_alloc(input.length);
  new Uint8Array(wasm.memory.buffer, inPtr, input.length).set(input);
  const outPtr = wasm.sp_call(op, inPtr, input.length);
  wasm.sp_free(inPtr, input.length);
  const len = new DataView(wasm.memory.buffer).getUint32(outPtr, true);
  const text = dec.decode(new Uint8Array(wasm.memory.buffer, outPtr + 4, len));
  wasm.sp_free(outPtr, len + 4);
  return JSON.parse(text);
}

// { amount, method, parts:[{id, value}] } -> { ok, data:[{id, amount}] } or { ok:false, error }
export const split = (req) => call(1, req);
// { expenses, payments, simplify } -> { ok, data:[{currency, nets, debts}] }
export const balances = (req) => call(2, req);
// { amount, from, to, fx:{target, rates, decimals} } -> { ok, data: amount }
export const convert = (req) => call(3, req);
// { expenses, payments, simplify, fx } -> same as balances, all in fx.target
export const balancesConverted = (req) => call(4, req);
