declare module "webaudio-tinysynth" {
  export default class WebAudioTinySynth {
    constructor(options?: { quality?: number; voices?: number; useReverb?: number });
    getAudioContext(): AudioContext;
    reset(): void;
    stopMIDI(): void;
    setMasterVol(value: number): void;
    send(message: number[], timestamp?: number): void;
  }
}
