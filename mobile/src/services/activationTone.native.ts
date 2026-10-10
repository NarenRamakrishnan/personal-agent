import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { File, Paths } from "expo-file-system";
export async function activationTone() {
  const file = new File(Paths.cache, "context-activation.wav");
  if (!file.exists) {
    const rate = 16000; const samples = 1920; const bytes = new Uint8Array(44 + samples * 2); const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 660 * i / rate) * 1600 * Math.sin(Math.PI * i / samples)), true);
    file.write(bytes);
  }
  await setAudioModeAsync({ playsInSilentMode: false });
  const player = createAudioPlayer(file.uri); player.play(); setTimeout(() => player.remove(), 1000);
}
