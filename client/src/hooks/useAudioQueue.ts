// Module-level state survives re-renders.
// AudioContext must be created inside a user gesture (Safari requirement).
let audioCtx: AudioContext | null = null;
let unlocked = false;
const queue: string[] = [];
const pendingQueue: string[] = []; // held until unlockAudio() is called
let isPlaying = false;

export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  // Create the AudioContext inside the user-gesture call stack —
  // this is what satisfies Safari's autoplay policy.
  audioCtx = new AudioContext();
  // Discard audio that built up before unlock (would play as an overwhelming flood).
  pendingQueue.length = 0;
  playNext();
}

async function playNext() {
  if (!unlocked || isPlaying || queue.length === 0 || !audioCtx) return;
  isPlaying = true;
  const audioBase64 = queue.shift()!;

  try {
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    // Decode base64 → ArrayBuffer → AudioBuffer
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.onended = () => {
      isPlaying = false;
      playNext();
    };
    source.start(0);
  } catch (err) {
    console.error('[audio] playback error:', err);
    isPlaying = false;
    playNext();
  }
}

export function useAudioQueue() {
  const enqueue = (audioBase64: string) => {
    if (unlocked) {
      queue.push(audioBase64);
      playNext();
    } else {
      pendingQueue.push(audioBase64);
    }
  };
  return { enqueue };
}
