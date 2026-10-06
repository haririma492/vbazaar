/**
 * The store's audio ads: a soft two-note chime from the product's side of
 * the view, then the product speaking its line.
 *
 * No audio files: the chime is synthesised (Web Audio) and the line is read
 * by the browser's own voice (Web Speech), so a merchant changes what a
 * product says by editing its catalogue row — the same way a price changes.
 *
 * Browsers only let a page make sound after a tap or click, so `unlock()`
 * runs inside the Play / Explore click.
 */
export class AdVoice {
  private ctx: AudioContext | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  muted = false;

  unlock() {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC && !this.ctx) this.ctx = new AC();
      void this.ctx?.resume();
    } catch {
      this.ctx = null;
    }
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    // iOS Safari speaks only if the first utterance came from a gesture.
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    synth.speak(u);
    this.pickVoice();
    synth.onvoiceschanged = () => this.pickVoice();
  }

  private pickVoice() {
    const voices = window.speechSynthesis?.getVoices() ?? [];
    const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
    const liked = ["Samantha", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Ava", "Allison", "Karen", "Serena", "Google UK English Female"];
    this.voice = liked.map((n) => en.find((v) => v.name.includes(n))).find(Boolean) ?? en[0] ?? null;
  }

  play(text: string, pan = 0) {
    if (this.muted) return;
    this.chime(pan);
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? "en-US";
    u.rate = 1.02;
    u.pitch = 1.12;
    u.volume = 1;
    window.setTimeout(() => synth.speak(u), 420);
  }

  private chime(pan: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const out = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (out) out.pan.value = Math.max(-1, Math.min(1, pan)) * 0.7;
    const master = ctx.createGain();
    master.gain.value = 0.22;
    if (out) master.connect(out).connect(ctx.destination);
    else master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    // A small shop bell: two notes, each a sine with a quieter octave above.
    for (const [freq, at] of [[1318.5, 0], [987.8, 0.16]] as const) {
      for (const [mult, level] of [[1, 1], [2.01, 0.25], [3.02, 0.08]] as const) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = freq * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0 + at);
        g.gain.linearRampToValueAtTime(level, t0 + at + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 1.4 / mult);
        o.connect(g).connect(master);
        o.start(t0 + at);
        o.stop(t0 + at + 1.5);
      }
    }
  }

  stop() {
    window.speechSynthesis?.cancel();
  }
}
