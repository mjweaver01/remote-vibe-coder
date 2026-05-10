// Voice transcription using Whisper via @huggingface/transformers.
// The model is downloaded on first use (cached in IndexedDB by transformers.js)
// and runs entirely in the browser — no audio leaves the device.

let pipelinePromise: Promise<any> | null = null;
const MODEL_ID = 'Xenova/whisper-tiny.en';
const TASK = 'automatic-speech-recognition';

export type LoadProgress = {
  file?: string;
  loaded?: number;
  total?: number;
  status?: string;
};

export function loadTranscriber(onProgress?: (p: LoadProgress) => void): Promise<any> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    const mod = await import('@huggingface/transformers');
    return mod.pipeline(TASK, MODEL_ID, {
      progress_callback: (p: any) => onProgress?.(p),
    });
  })();
  return pipelinePromise;
}

/**
 * Decode an audio blob (whatever MediaRecorder produced) into a Float32Array
 * sampled at 16 kHz, mono — Whisper's expected input format.
 */
export async function blobToMonoFloat32(blob: Blob, sampleRate = 16000): Promise<Float32Array> {
  const arrayBuf = await blob.arrayBuffer();
  // Use OfflineAudioContext to decode + resample in one shot.
  const tmpCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  let decoded: AudioBuffer;
  try {
    decoded = await tmpCtx.decodeAudioData(arrayBuf.slice(0));
  } finally {
    tmpCtx.close();
  }
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

export async function transcribe(blob: Blob, onProgress?: (p: LoadProgress) => void): Promise<string> {
  const transcriber = await loadTranscriber(onProgress);
  const audio = await blobToMonoFloat32(blob);
  const out = await transcriber(audio);
  if (Array.isArray(out)) return (out[0]?.text ?? '').trim();
  return String(out?.text ?? '').trim();
}

export function isLoaded(): boolean {
  return pipelinePromise !== null;
}
