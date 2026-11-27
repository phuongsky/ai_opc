/**
 * Renderer Canvas 2D cho VideoTimeline — dùng chung cho xem trước (preview) và
 * xuất file (MediaRecorder), nên hình ảnh xuất ra = đúng những gì thấy trong preview.
 */
import type { TimelineClip, VideoTimeline } from "@ai-opc/shared";

export type ImageCache = Map<string, HTMLImageElement>;

/** Độ mờ của clip tại thời điểm t, theo fade in/out (0–1). */
export function clipAlpha(c: TimelineClip, t: number): number {
  let a = 1;
  const fi = c.fadeIn ?? 0;
  const fo = c.fadeOut ?? 0;
  if (fi > 0 && t - c.start < fi) a = Math.min(a, Math.max(0, (t - c.start) / fi));
  const end = c.start + c.duration;
  if (fo > 0 && end - t < fo) a = Math.min(a, Math.max(0, (end - t) / fo));
  return a;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = `${line} ${words[i]}`;
      if (ctx.measureText(test).width <= maxWidth) line = test;
      else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
  }
  return lines;
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  tl: VideoTimeline,
  t: number,
  images: ImageCache
): void {
  const W = tl.width;
  const H = tl.height;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = tl.background;
  ctx.fillRect(0, 0, W, H);

  // Track đầu danh sách nằm trên cùng → vẽ từ dưới lên.
  for (let ti = tl.tracks.length - 1; ti >= 0; ti--) {
    for (const c of tl.tracks[ti].clips) {
      if (t < c.start || t >= c.start + c.duration) continue;
      const alpha = clipAlpha(c, t);
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      const cx = (c.x ?? 0.5) * W;
      const cy = (c.y ?? 0.5) * H;

      if (c.type === "color") {
        ctx.fillStyle = c.color ?? "#000000";
        ctx.fillRect(0, 0, W, H);
      } else if (c.type === "image" && c.src) {
        const img = images.get(c.src);
        if (img && img.complete && img.naturalWidth > 0) {
          const w = (c.scale ?? 1) * W;
          const h = (w * img.naturalHeight) / img.naturalWidth;
          ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
        }
      } else if (c.type === "text" && c.text) {
        const size = c.fontSize ?? 48;
        ctx.font = `${c.fontWeight ?? "bold"} ${size}px system-ui, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = c.textColor ?? "#FFFFFF";
        ctx.textBaseline = "middle";
        const lines = wrapText(ctx, c.text, W * 0.9);
        const lineH = size * 1.25;
        const blockW = Math.max(...lines.map((l) => ctx.measureText(l).width));
        const align = c.align ?? "center";
        ctx.textAlign = align;
        const ax = align === "left" ? cx - blockW / 2 : align === "right" ? cx + blockW / 2 : cx;
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = Math.max(4, size / 8);
        const top = cy - ((lines.length - 1) * lineH) / 2;
        lines.forEach((l, i) => ctx.fillText(l, ax, top + i * lineH));
        ctx.shadowBlur = 0;
      }
    }
  }
  ctx.restore();
}

/** Tải trước các ảnh trong timeline. Trả về danh sách src lỗi (không tải được / thiếu CORS). */
export async function preloadImages(tl: VideoTimeline, cache: ImageCache): Promise<string[]> {
  const failed: string[] = [];
  const srcs = new Set<string>();
  for (const tr of tl.tracks) for (const c of tr.clips) if (c.type === "image" && c.src && !cache.has(c.src)) srcs.add(c.src);
  await Promise.all(
    [...srcs].map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          if (!src.startsWith("data:")) img.crossOrigin = "anonymous"; // để canvas không bị "tainted" khi xuất
          img.onload = () => {
            cache.set(src, img);
            resolve();
          };
          img.onerror = () => {
            failed.push(src);
            resolve();
          };
          img.src = src;
        })
    )
  );
  return failed;
}

export function pickRecorderMime(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: Array<[string, string]> = [
    ["video/webm;codecs=vp9", "webm"],
    ["video/webm;codecs=vp8", "webm"],
    ["video/webm", "webm"],
    ["video/mp4", "mp4"],
  ];
  for (const [mime, ext] of candidates) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return null;
}

/**
 * Xuất video bằng cách phát timeline lên canvas và ghi bằng MediaRecorder (thời gian thực).
 * Giới hạn: chưa có âm thanh; tab phải giữ mở/foreground trong lúc xuất.
 */
export async function exportVideo(
  tl: VideoTimeline,
  images: ImageCache,
  duration: number,
  onProgress: (ratio: number) => void,
  signal: AbortSignal
): Promise<{ blob: Blob; ext: string }> {
  const picked = pickRecorderMime();
  if (!picked) throw new Error("Trình duyệt không hỗ trợ MediaRecorder để xuất video.");
  const canvas = document.createElement("canvas");
  canvas.width = tl.width;
  canvas.height = tl.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Không tạo được canvas.");

  const stream = canvas.captureStream(tl.fps);
  const recorder = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error("Lỗi khi ghi video."));
  });

  renderFrame(ctx, tl, 0, images);
  recorder.start(250);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      if (signal.aborted) return resolve();
      const t = (performance.now() - t0) / 1000;
      renderFrame(ctx, tl, Math.min(t, duration - 1e-3), images);
      onProgress(Math.min(1, t / duration));
      if (t >= duration) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((tr) => tr.stop());
  if (signal.aborted) throw new Error("Đã hủy xuất video.");
  return { blob: new Blob(chunks, { type: picked.mime }), ext: picked.ext };
}
