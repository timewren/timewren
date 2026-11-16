// Type-shim: web-backendens auth.ts importerer messagebird dynamisk. Mobilappen
// bruger det aldrig, men typedelingen med web kræver at modulet kan opløses.
declare module 'messagebird' {
  const init: (apiKey: string) => { messages: { create: (...args: unknown[]) => void } };
  export default init;
}
