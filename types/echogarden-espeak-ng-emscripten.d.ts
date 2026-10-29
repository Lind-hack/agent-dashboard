// Minimal types for the parts of @echogarden/espeak-ng-emscripten 0.3.5 we use (the package ships none).
declare module "@echogarden/espeak-ng-emscripten" {
  export type ESpeakNGWorker = {
    set_voice(voice: string): void;
    synthesize_ipa(text: string): { code: number; ipa: string };
    convert_to_phonemes(text: string, useIpa: boolean): { ptr: number };
  };
  export type ESpeakNGModule = {
    eSpeakNGWorker: new () => ESpeakNGWorker;
    HEAPU8: Uint8Array;
  };
  const create: () => Promise<ESpeakNGModule>;
  export default create;
}
