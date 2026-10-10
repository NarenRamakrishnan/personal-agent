export async function activationTone() {
  const AudioContextClass = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  try {
    await context.resume(); const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.frequency.value = 660; gain.gain.value = 0.05; oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.12);
    oscillator.onended = () => { void context.close(); };
  } catch { await context.close(); }
}
