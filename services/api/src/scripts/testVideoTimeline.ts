/**
 * Test logic timeline (shared) + lưu/dựng timeline qua videoService — không cần DB thật.
 *   tsx src/scripts/testVideoTimeline.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "path";
import assert from "assert";
import {
  addTrack, createEmptyTimeline, duplicateClip, findClip, placeClip, removeClip, resizeClip,
  scriptToTimeline, splitClipAt, timelineDuration, validateTimeline, MAX_TIMELINE_SECONDS,
} from "@ai-opc/shared";

const rows: any[] = [];
const fakeDb: any = {
  video: {
    async create({ data }: any) { const r = { brief: null, script: null, platform: null, aspectRatio: "16:9", durationSec: null, tags: null, timeline: null, assetUrl: null, thumbnailUrl: null, provider: null, providerJobId: null, publishedUrl: null, costUsd: 0, notes: null, taskId: null, createdAt: new Date(), updatedAt: new Date(), publishedAt: null, ...data }; rows.push(r); return { ...r }; },
    async findUnique({ where }: any) { const r = rows.find((x) => x.id === where.id); return r ? { ...r } : null; },
    async update({ where, data }: any) { const r = rows.find((x) => x.id === where.id); Object.assign(r, data, { updatedAt: new Date() }); return { ...r }; },
    async findMany() { return rows.map((r) => ({ ...r })); },
  },
  auditLog: { async create({ data }: any) { return data; } },
};
const clientPath = require.resolve(path.resolve(__dirname, "../db/client"));
(require as any).cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { db: fakeDb } };

const ok = (m: string) => console.log(`  ✓ ${m}`);

async function run() {
  console.log("=== TEST VIDEO TIMELINE ===");
  const clip = (id: string, start: number, duration: number): any => ({ id, type: "color", start, duration, color: "#000000" });

  // placeClip: không chồng lấn
  let tl = createEmptyTimeline("16:9");
  const tid = tl.tracks[0].id;
  tl = placeClip(tl, clip("a", 0, 3), tid, 0);
  tl = placeClip(tl, clip("b", 0, 2), tid, 1);
  assert.ok(findClip(tl, "b")!.clip.start >= 3, "b phải bị đẩy ra sau a");
  assert.ok(validateTimeline(tl).ok);
  ok("placeClip tránh chồng lấn, timeline hợp lệ");

  // validate: chồng lấn thủ công bị từ chối
  const bad = JSON.parse(JSON.stringify(tl));
  bad.tracks[0].clips[1].start = 1;
  assert.ok(!validateTimeline(bad).ok);
  ok("validate từ chối clip chồng lấn");

  // ảnh: chặn javascript:/http
  for (const src of ["javascript:alert(1)", "http://x.com/a.png"]) {
    const t2 = JSON.parse(JSON.stringify(tl));
    t2.tracks[0].clips[0] = { id: "img", type: "image", start: 0, duration: 1, src };
    assert.ok(!validateTimeline(t2).ok, src);
  }
  ok("chặn src ảnh javascript:/http");

  // vượt 600s
  const long = createEmptyTimeline();
  long.tracks[0].clips.push(clip("z", 0, MAX_TIMELINE_SECONDS + 5));
  assert.ok(!validateTimeline(long).ok);
  ok("giới hạn tổng thời lượng");

  // split / resize / duplicate / remove
  const before = timelineDuration(tl);
  const sp = splitClipAt(tl, "a", 1);
  assert.strictEqual(sp.tracks[0].clips.length, tl.tracks[0].clips.length + 1);
  assert.strictEqual(timelineDuration(sp), before);
  ok("splitClipAt giữ nguyên tổng thời lượng");
  const rs = resizeClip(tl, "a", "right", 2);
  assert.strictEqual(findClip(rs, "a")!.clip.duration, 2);
  ok("resizeClip trim mép phải");
  const dup = duplicateClip(tl, "a");
  assert.ok(dup.newId && findClip(dup.timeline, dup.newId));
  assert.ok(validateTimeline(dup.timeline).ok);
  ok("duplicateClip tạo clip hợp lệ");
  assert.ok(!findClip(removeClip(tl, "a"), "a"));
  assert.ok(addTrack(tl).tracks.length === tl.tracks.length + 1);
  ok("removeClip / addTrack");

  // scriptToTimeline
  const st = scriptToTimeline("Hook: Xin chào\nNội dung: Sản phẩm mới\nCTA: Mua ngay", { aspectRatio: "9:16", targetSeconds: 15 });
  assert.ok(validateTimeline(st).ok);
  assert.ok(Math.abs(timelineDuration(st) - 15) < 0.1, `duration=${timelineDuration(st)}`);
  assert.strictEqual(st.tracks[0].clips.length, 3);
  assert.ok(st.height > st.width);
  ok("scriptToTimeline: 3 cảnh, co giãn đúng 15s, dọc 9:16");

  // videoService
  const svc = require("../modules/videos/videoService");
  const founder = { actor: "founder", actorId: "FOUNDER" } as any;
  const v = await svc.createVideo({ title: "T", script: "Hook: A\nCTA: B" }, founder);
  const built = await svc.buildTimelineFromScript(v.id, founder);
  assert.ok(built.hasTimeline);
  const full = await svc.getVideo(v.id);
  assert.ok(full.timeline);
  assert.strictEqual(built.status, "SCRIPTED");
  ok("buildTimelineFromScript lưu timeline, hasTimeline=true");
  await assert.rejects(() => svc.buildTimelineFromScript(v.id, founder), /đã có timeline/);
  ok("không ghi đè timeline nếu thiếu overwrite");
  assert.ok((await svc.listVideos())[0].timeline === undefined, "list không kèm timeline");
  assert.ok((await svc.getVideo(v.id)).timeline);
  ok("list chỉ trả hasTimeline; getVideo trả timeline");
  await assert.rejects(() => svc.saveTimeline(v.id, { nope: 1 }, founder), /không hợp lệ/);
  ok("saveTimeline từ chối dữ liệu sai");
  rows[0].status = "PUBLISHED";
  await assert.rejects(() => svc.saveTimeline(v.id, full.timeline, founder), /Không sửa timeline/);
  ok("không sửa timeline khi PUBLISHED");
  // Khôi phục phong bì khi model chỉ trả params
  const { recoverVideoDecision } = require("../modules/videos/videoRecovery");
  const valid = new Set(["tool_video_draft", "tool_video_search", "tool_video_generate"]);
  const r1 = recoverVideoDecision({ operation: "create", data: { title: "X" } }, valid);
  assert.deepStrictEqual([r1.action, r1.toolId], ["CALL_TOOL", "tool_video_draft"]);
  assert.strictEqual(recoverVideoDecision({ operation: "list" }, valid).toolId, "tool_video_search");
  assert.strictEqual(recoverVideoDecision({ operation: "submit", id: "v" }, valid).toolId, "tool_video_generate");
  assert.strictEqual(recoverVideoDecision({ action: "NONE", note: "x" }, valid), null);
  assert.strictEqual(recoverVideoDecision({ operation: "create", data: { title: "X" } }, new Set()), null);
  assert.strictEqual(recoverVideoDecision({ operation: "publish" }, valid), null);
  ok("recoverVideoDecision: suy ra tool từ operation, không tự suy publish, tôn trọng quyền");

  // Khôi phục thông minh từ văn bản / câu từ chối
  const { recoverVideoIntentFromText } = require("../modules/videos/videoRecovery");
  const rText = await recoverVideoIntentFromText(
    '{"error": "Không thể thực hiện yêu cầu. Tôi là một trợ lý AI dựa trên văn bản..."}',
    { title: "Tạo video giới thiệu dự án này", objective: "Tạo video giới thiệu dự án này" },
    valid
  );
  assert.ok(rText && rText.action === "CALL_TOOL" && rText.toolId === "tool_video_draft");
  assert.strictEqual((rText.params.data as any).autoTimeline, true);
  ok("recoverVideoIntentFromText: tự động tạo draft và timeline khi gặp câu từ chối");

  // normalizePlatform
  assert.strictEqual(svc.normalizePlatform("reels"), "instagram");
  assert.strictEqual(svc.normalizePlatform("shorts"), "youtube");
  assert.strictEqual(svc.normalizePlatform("youtube"), "youtube");
  ok("normalizePlatform: map reels -> instagram, shorts -> youtube");

  // recoverVideoIntentFromText với tool_video_generate
  const validGen = new Set(["tool_video_draft", "tool_video_search", "tool_video_generate", "tool_video_publish"]);
  rows[0].status = "SCRIPTED";
  const rGen = await recoverVideoIntentFromText(
    "tool_video_generate",
    { title: "Chạy lệnh sinh video", objective: "Chạy lệnh sinh video" },
    validGen
  );
  assert.ok(rGen && rGen.action === "CALL_TOOL" && rGen.toolId === "tool_video_generate");
  assert.strictEqual(rGen.params.id, rows[0].id);
  ok("recoverVideoIntentFromText: khớp lệnh tool_video_generate với video SCRIPTED");

  // recoverVideoIntentFromText với lệnh Approve / Duyệt
  rows[0].status = "REVIEW";
  const rApprove = await recoverVideoIntentFromText(
    '{"status": "APPROVED", "message": "Task đã được phê duyệt."}',
    { title: "Approve", objective: "Approve" },
    validGen
  );
  assert.ok(rApprove && rApprove.action === "NONE");
  assert.ok(rApprove.note.includes("phê duyệt thành công"));
  assert.ok(rApprove.note.includes("xuất bản/export"));
  assert.strictEqual(rows[0].status, "APPROVED");
  ok("recoverVideoIntentFromText: lệnh Approve chuyển REVIEW thành APPROVED và hỏi xuất bản");

  // recoverVideoIntentFromText xác nhận xuất bản với câu trả lời "Có" / "Export"
  const rConfirmExport = await recoverVideoIntentFromText(
    "Có",
    { title: "Có", objective: "Có, hãy xuất bản video này" },
    validGen
  );
  assert.ok(rConfirmExport && rConfirmExport.action === "CALL_TOOL" && rConfirmExport.toolId === "tool_video_publish");
  assert.strictEqual(rConfirmExport.params.id, rows[0].id);
  ok("recoverVideoIntentFromText: câu trả lời 'Có'/'Export' kích hoạt tool_video_publish cho video APPROVED");

  // recoverVideoIntentFromText với tool_video_publish
  rows[0].status = "APPROVED";
  const rPub = await recoverVideoIntentFromText(
    "tool_video_publish",
    { title: "Xuất bản video", objective: "Xuất bản video" },
    validGen
  );
  assert.ok(rPub && rPub.action === "CALL_TOOL" && rPub.toolId === "tool_video_publish");
  assert.strictEqual(rPub.params.id, rows[0].id);
  ok("recoverVideoIntentFromText: khớp lệnh tool_video_publish với video APPROVED");

  console.log("\nALL PASSED");
}
run().catch((e) => { console.error(e); process.exit(1); });
