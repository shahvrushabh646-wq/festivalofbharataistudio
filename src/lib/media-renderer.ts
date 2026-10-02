export interface RenderInput {
  imageUrls: string[];
  captions: string[];
  durations: number[];
  title?: string;
}

export interface RenderOutput {
  blob: Blob;
  mimeType: string;
  fileName: string;
  url: string;
  width: number;
  height: number;
  duration: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Unable to load visual asset"));
    img.src = src;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > max && line) {
      lines.push(line);
      line = w;
    } else {
      line = t;
    }
  }

  if (line) lines.push(line);
  return lines;
}

export async function renderVerticalReel(input: RenderInput): Promise<RenderOutput> {
  const width = 1080;
  const height = 1920;
  const fps = 30;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");

  const images = await Promise.all(
    input.imageUrls.map(async (u) => {
      try {
        return await loadImage(u);
      } catch {
        return null;
      }
    }),
  );

  const stream = canvas.captureStream(fps);

  let audioCtx: AudioContext | undefined;
  let destination: MediaStreamAudioDestinationNode | undefined;
  let osc1: OscillatorNode | undefined;
  let osc2: OscillatorNode | undefined;
  let gain: GainNode | undefined;

  try {
    audioCtx = new AudioContext();
    destination = audioCtx.createMediaStreamDestination();
    gain = audioCtx.createGain();
    gain.gain.value = 0.015;
    osc1 = audioCtx.createOscillator();
    osc2 = audioCtx.createOscillator();
    osc1.frequency.value = 220;
    osc2.frequency.value = 329.63;
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(destination);
    osc1.start();
    osc2.start();
    destination.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  } catch {}

  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
    ? "video/webm;codecs=vp9,opus"
    : "video/webm";

  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 7_000_000,
  });

  const chunks: BlobPart[] = [];
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  recorder.start(250);
  const start = performance.now();

  for (let i = 0; i < input.captions.length; i++) {
    const duration = Math.max(1.5, input.durations[i] || 2.5);
    const until = performance.now() + duration * 1000;
    const img = images[i % Math.max(images.length, 1)];

    while (performance.now() < until) {
      const p = 1 - (until - performance.now()) / (duration * 1000);

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, width, height);

      if (img) {
        const scale =
          Math.max(width / img.naturalWidth, height / img.naturalHeight) * (1 + 0.04 * p);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
      } else {
        const g = ctx.createLinearGradient(0, 0, width, height);
        g.addColorStop(0, "#4f46e5");
        g.addColorStop(1, "#7c3aed");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
      }

      ctx.fillStyle = "rgba(0,0,0,.28)";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.font = "700 54px Arial";

      const lines = wrap(ctx, input.captions[i] || input.title || "", 860);
      let y = height * 0.68;

      for (const line of lines.slice(0, 5)) {
        ctx.fillText(line, width / 2, y);
        y += 70;
      }

      ctx.font = "500 28px Arial";
      ctx.fillStyle = "rgba(255,255,255,.8)";
      ctx.fillText("Festival of Bharat", width / 2, height - 90);

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  recorder.stop();
  await stopped;

  try {
    osc1?.stop();
    osc2?.stop();
    await audioCtx?.close();
  } catch {}

  const blob = new Blob(chunks, { type: "video/webm" });

  return {
    blob,
    mimeType: "video/webm",
    fileName: `festival-of-bharat-${Date.now()}.webm`,
    url: URL.createObjectURL(blob),
    width,
    height,
    duration: (performance.now() - start) / 1000,
  };
}

export async function convertWebMToMP4(webm: Blob): Promise<RenderOutput> {
  const [{ FFmpeg }, { fetchFile }] = await Promise.all([
    import("@ffmpeg/ffmpeg"),
    import("@ffmpeg/util"),
  ]);

  const ffmpeg = new FFmpeg();
  const core =
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js";
  const wasm =
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm";
  const worker =
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.worker.js";

  await ffmpeg.load({ coreURL: core, wasmURL: wasm, workerURL: worker });
  await ffmpeg.writeFile("input.webm", await fetchFile(webm));
  await ffmpeg.exec([
    "-i",
    "input.webm",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "faststart",
    "-an",
    "output.mp4",
  ]);

  const data = await ffmpeg.readFile("output.mp4");
  const blob = new Blob([data as Uint8Array], { type: "video/mp4" });

  return {
    blob,
    mimeType: "video/mp4",
    fileName: `festival-of-bharat-${Date.now()}.mp4`,
    url: URL.createObjectURL(blob),
    width: 1080,
    height: 1920,
    duration: 0,
  };
}
