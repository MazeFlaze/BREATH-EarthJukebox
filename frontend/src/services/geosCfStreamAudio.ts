import type { DetailControls, DetailFrames, DetailTick } from '@/types/geosCfDetail';
import type { DemoState } from '@/types/notebookDemo';

/** The worklet owns a cursor and a small oscillator bank, never a multi-minute PCM buffer. */
export class GeosCfStreamAudio {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private output: GainNode | null = null;
  private module: Promise<void> | null = null;
  private generation = 0;
  private disposed = false;
  state: DemoState = 'ready';
  constructor(private tick: (tick: DetailTick) => void, private stateChanged: (state: DemoState) => void,
    private error: (error: string) => void, private completed?: () => void) {}
  private report(state: DemoState) { this.state = state; this.stateChanged(state); }
  async play(frames: DetailFrames, duration: number, controls: DetailControls, startStep = 0, previewSeconds?: number) {
    if (this.disposed) return;
    this.stop(); const token = this.generation;
    if (!this.context) this.context = new AudioContext();
    const context = this.context;
    const unlocked = context.resume();
    this.module ??= context.audioWorklet.addModule('/audio/geos-cf-stream.worklet.mjs').catch(cause => { this.module = null; throw cause; });
    await Promise.all([this.module, unlocked]);
    if (token !== this.generation || this.disposed) return;
    const node = new AudioWorkletNode(context, 'geos-cf-detail-stream', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.node = node;
    node.onprocessorerror = () => { if (token === this.generation) { this.stop(); this.error('AudioWorklet gặp lỗi. Hãy giảm số voice hoặc chọn Focus.'); } };
    node.port.onmessage = ({ data }) => {
      if (token !== this.generation || this.disposed) return;
      if (data.type === 'ready') {
        node.port.postMessage({ type: 'seek', step: startStep });
        if (previewSeconds) node.port.postMessage({ type: 'limit', seconds: previewSeconds });
        node.port.postMessage({ type: 'playing', value: true }); this.report('playing');
      } else if (data.type === 'error') { this.stop(); this.error(data.error); }
      else if (data.type === 'tick') {
        this.tick(data as DetailTick);
        if (data.done) { this.stop(); this.completed?.(); }
      }
    };
    const output = context.createGain(); this.output = output;
    output.gain.setValueAtTime(0, context.currentTime); output.gain.linearRampToValueAtTime(1, context.currentTime + .02);
    node.connect(output); output.connect(context.destination);
    node.port.postMessage({ type: 'load', frames, duration, controls });
  }
  controls(controls: Partial<DetailControls>) { this.node?.port.postMessage({ type: 'controls', controls }); }
  seek(step: number) { this.node?.port.postMessage({ type: 'seek', step }); }
  pause() {
    if (this.state !== 'playing' || !this.node || !this.context) return;
    const node = this.node, token = this.generation;
    this.output?.gain.setTargetAtTime(0, this.context.currentTime, .004); this.report('paused');
    setTimeout(() => { if (token === this.generation && this.state === 'paused') node.port.postMessage({ type: 'playing', value: false }); }, 20);
  }
  async resume() {
    const token = this.generation; await this.context?.resume();
    if (token !== this.generation || this.disposed || !this.node) return;
    this.node.port.postMessage({ type: 'playing', value: true }); this.report('playing');
    if (this.context) this.output?.gain.setTargetAtTime(1, this.context.currentTime, .008);
  }
  stop() {
    this.generation++;
    if (this.node) {
      const node = this.node, output = this.output;
      node.port.onmessage = null;
      if (this.context && output) output.gain.setTargetAtTime(0, this.context.currentTime, .004);
      setTimeout(() => { node.port.postMessage({ type: 'dispose' }); node.disconnect(); node.port.close(); output?.disconnect(); }, 20);
      this.node = null; this.output = null;
    }
    this.report('ready');
  }
  dispose() { this.stop(); this.disposed = true; if (this.context) void this.context.close(); this.context = null; }
}
