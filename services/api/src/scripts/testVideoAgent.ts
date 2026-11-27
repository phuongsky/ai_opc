/**
 * Test luồng Video Agent end-to-end qua Tool Gateway — KHÔNG cần database thật.
 * `db` được thay bằng bản in-memory (inject vào require.cache trước khi import nghiệp vụ),
 * nên chạy được ở bất kỳ đâu:   tsx src/scripts/testVideoAgent.ts
 *
 * Kiểm tra:
 *  1. Permission Matrix: L2..L5 đúng; agent khác không có quyền → bị chặn.
 *  2. State machine: chuyển trạng thái hợp lệ/không hợp lệ; Agent không tự APPROVED/REJECTED/PUBLISHED.
 *  3. tool_video_publish (R3) → AWAITING_APPROVAL; chỉ sau executeApprovedDecision mới PUBLISHED.
 *  4. Provider mô phỏng: video đi tới REVIEW, assetUrl = null, có ghi chú "MÔ PHỎNG".
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "path";
import assert from "assert";

// ---- Fake in-memory DB -------------------------------------------------------
type Row = Record<string, any>;

function table(pk: string[] = ["id"], defaults: () => Row = () => ({})) {
  const rows: Row[] = [];
  const keyOf = (r: Row) => pk.map((k) => r[k]).join("|");
  const match = (r: Row, where: Row = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        // compound unique: { agentId_toolId: { agentId, toolId } }
        return Object.entries(v as Row).every(([kk, vv]) => r[kk] === vv);
      }
      return r[k] === v;
    });
  const unwrap = (where: Row = {}) => {
    const first = Object.values(where)[0];
    return pk.length > 1 && first && typeof first === "object" ? (first as Row) : where;
  };
  return {
    rows,
    async create({ data }: { data: Row }) {
      const row = { ...defaults(), ...data };
      rows.push(row);
      return { ...row };
    },
    async findUnique({ where }: { where: Row }) {
      const w = unwrap(where);
      const r = rows.find((x) => match(x, w));
      return r ? { ...r } : null;
    },
    async findMany({ where, take, select }: { where?: Row; take?: number; select?: Row } = {}) {
      let out = rows.filter((x) => match(x, where));
      out = out.sort((a, b) => +(b.updatedAt ?? 0) - +(a.updatedAt ?? 0));
      if (take) out = out.slice(0, take);
      return out.map((r) =>
        select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : { ...r }
      );
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const w = unwrap(where);
      const r = rows.find((x) => match(x, w));
      if (!r) throw new Error("Record not found");
      Object.assign(r, data, { updatedAt: new Date() });
      return { ...r };
    },
    async upsert({ where, update, create }: { where: Row; update: Row; create: Row }) {
      const w = unwrap(where);
      const r = rows.find((x) => match(x, w));
      if (r) return Object.assign(r, update);
      rows.push({ ...create });
      return { ...create };
    },
  };
}

const fakeDb: any = {
  video: table(["id"], () => ({
    brief: null, script: null, platform: null, aspectRatio: "16:9", durationSec: null, tags: null,
    timeline: null, assetUrl: null, thumbnailUrl: null, provider: null, providerJobId: null, publishedUrl: null,
    costUsd: 0, notes: null, taskId: null, createdAt: new Date(), updatedAt: new Date(), publishedAt: null,
  })),
  auditLog: table(["id"]),
  agent: table(["id"]),
  department: table(["id"]),
  tool: table(["id"]),
  agentToolPermission: table(["agentId", "toolId"]),
  decisionPackage: table(["id"]),
  task: table(["id"]),
};

const clientPath = require.resolve(path.resolve(__dirname, "../db/client"));
(require as any).cache[clientPath] = {
  id: clientPath,
  filename: clientPath,
  loaded: true,
  exports: { db: fakeDb },
};

// ---- Test -------------------------------------------------------------------
async function run() {
  const { ensureVideoAgent, VIDEO_AGENT_ID } = require("../modules/videos/videoAgent");
  const { registerVideoToolDrivers } = require("../modules/videos/videoTools");
  const { toolGateway } = require("../modules/governance/toolGateway");
  const video = require("../modules/videos/videoService");

  const log = (m: string) => console.log(`  ✓ ${m}`);
  const rejects = async (fn: () => Promise<unknown>, re: RegExp, label: string) => {
    try {
      await fn();
    } catch (e: any) {
      assert.match(String(e?.message), re, `${label}: sai thông báo lỗi → ${e?.message}`);
      return log(label);
    }
    assert.fail(`${label}: lẽ ra phải ném lỗi`);
  };

  console.log("=== TEST VIDEO AGENT ===");

  // Seed tối thiểu: dept + marketing agent rồi bootstrap video agent
  await fakeDb.department.create({ data: { id: "dept_marketing", name: "Marketing" } });
  await fakeDb.agent.create({ data: { id: "agent_marketing", name: "AI-Marketing", status: "READY" } });
  await fakeDb.agent.create({ data: { id: "agent_sales", name: "AI-Sales", status: "READY" } });

  console.log("1. Bootstrap agent");
  assert.deepStrictEqual(await ensureVideoAgent(), { created: true });
  assert.deepStrictEqual(await ensureVideoAgent(), { created: false });
  log("ensureVideoAgent tạo lần đầu, lần 2 idempotent (không tạo lại)");
  assert.strictEqual(fakeDb.tool.rows.length, 5);
  assert.strictEqual(fakeDb.agentToolPermission.rows.length, 6);
  assert.strictEqual((await fakeDb.agent.findUnique({ where: { id: VIDEO_AGENT_ID } })).departmentId, "dept_marketing");
  log("5 tool, 6 grant (5 cho AI-Video + 1 read-only cho AI-Marketing)");

  // Founder đã gỡ 1 quyền → bootstrap lần sau KHÔNG được cấp lại
  fakeDb.agentToolPermission.rows.splice(
    fakeDb.agentToolPermission.rows.findIndex((r: Row) => r.toolId === "tool_video_generate"),
    1
  );
  await ensureVideoAgent();
  assert.ok(!fakeDb.agentToolPermission.rows.some((r: Row) => r.toolId === "tool_video_generate"));
  fakeDb.agentToolPermission.rows.push({ agentId: VIDEO_AGENT_ID, toolId: "tool_video_generate", permissionLevel: "L4" });
  log("không ghi đè quyền Founder đã chỉnh");

  registerVideoToolDrivers();
  const call = (tool: string, params: any, agent = VIDEO_AGENT_ID) =>
    toolGateway.execute(agent, tool, null, params);

  console.log("2. Permission Matrix");
  await rejects(() => call("tool_video_search", { operation: "list" }, "agent_sales"), /không có quyền/, "agent_sales bị chặn tool_video_search");
  await rejects(() => call("tool_video_draft", { operation: "create", data: { title: "x" } }, "agent_marketing"), /không có quyền/, "AI-Marketing chỉ đọc, không được tạo draft");
  const mk = await call("tool_video_search", { operation: "stats" }, "agent_marketing");
  assert.strictEqual(mk.status, "SUCCESS");
  log("AI-Marketing đọc được thống kê");

  console.log("3. Tạo & vòng đời");
  const created = await call("tool_video_draft", {
    operation: "create",
    data: { title: "Giới thiệu sản phẩm X", platform: "TikTok", aspectRatio: "9:16", durationSec: 30, tags: "Sản phẩm, SẢN PHẨM, demo" },
  });
  assert.strictEqual(created.status, "SUCCESS");
  const id: string = created.data.id;
  assert.strictEqual(created.data.status, "IDEA");
  assert.strictEqual(created.data.platform, "tiktok");
  log("tạo draft không script → IDEA, platform chuẩn hóa lowercase");
  const full = await video.getVideo(id);
  assert.deepStrictEqual(full.tags, ["sản phẩm", "demo"]);
  log("tags được chuẩn hóa & khử trùng");

  await rejects(() => call("tool_video_generate", { operation: "submit", id }), /Không thể chuyển IDEA → GENERATING/, "không sinh video khi chưa có script");
  await rejects(() => call("tool_video_set_status", { id, status: "APPROVED" }), /Chỉ Founder/, "Agent không tự APPROVED");
  await rejects(() => call("tool_video_set_status", { id, status: "PUBLISHED" }), /tool_video_publish/, "Agent không set PUBLISHED trực tiếp");

  const upd = await call("tool_video_draft", { operation: "update", id, data: { script: "Hook: ...\nNội dung: ...\nCTA: ..." } });
  assert.strictEqual(upd.data.status, "SCRIPTED");
  log("thêm script cho video IDEA → tự lên SCRIPTED");

  console.log("4. Sinh video (provider mô phỏng)");
  const gen = await call("tool_video_generate", { operation: "submit", id });
  assert.strictEqual(gen.status, "SUCCESS");
  assert.strictEqual(gen.data.status, "REVIEW");
  assert.strictEqual(gen.data.simulated, true);
  assert.strictEqual(gen.data.assetUrl, null);
  const afterGen = await video.getVideo(id);
  assert.match(afterGen.notes, /MÔ PHỎNG/);
  log("SCRIPTED → GENERATING → REVIEW; assetUrl null + ghi chú MÔ PHỎNG (không giả vờ có file)");

  console.log("5. Xuất bản cần Founder duyệt (R3)");
  const pub = await call("tool_video_publish", { id, platform: "tiktok", publishedUrl: "https://tiktok.com/@x/video/1" });
  assert.strictEqual(pub.status, "AWAITING_APPROVAL");
  assert.strictEqual((await video.getVideo(id)).status, "REVIEW");
  log("publish → AWAITING_APPROVAL, video vẫn REVIEW (chưa thực thi)");
  assert.strictEqual(fakeDb.decisionPackage.rows.length, 1);

  const done = await toolGateway.executeApprovedDecision(pub.decisionPackageId);
  assert.strictEqual(done.status, "SUCCESS");
  const published = await video.getVideo(id);
  assert.strictEqual(published.status, "PUBLISHED");
  assert.strictEqual(published.publishedUrl, "https://tiktok.com/@x/video/1");
  assert.ok(published.publishedAt);
  log("sau khi Founder duyệt → PUBLISHED, có publishedUrl + publishedAt");

  await rejects(() => video.updateVideo(id, { title: "sửa" }, { actor: "agent" }), /PUBLISHED/, "không sửa được video đã PUBLISHED");
  await rejects(() => video.setVideoStatus(id, "ARCHIVED", { actor: "founder" }), /Không thể chuyển PUBLISHED/, "PUBLISHED là trạng thái cuối");

  console.log("6. Founder (UI) + validation");
  const v2 = await video.createVideo({ title: "Video 2", script: "s" }, { actor: "founder" });
  assert.strictEqual(v2.status, "SCRIPTED");
  assert.strictEqual(v2.createdBy, "FOUNDER");
  await video.setVideoStatus(v2.id, "GENERATING", { actor: "agent" });
  await video.recordGeneration(v2.id, { status: "REVIEW", provider: "x", costUsd: 0.5 }, { actor: "agent" });
  const approved = await video.setVideoStatus(v2.id, "APPROVED", { actor: "founder" });
  assert.strictEqual(approved.status, "APPROVED");
  log("Founder được APPROVED (REVIEW → APPROVED)");
  await rejects(() => video.createVideo({ title: "  " }, { actor: "founder" }), /Tiêu đề/, "tiêu đề rỗng bị từ chối");
  await rejects(() => video.createVideo({ title: "a", platform: "myspace" }, { actor: "founder" }), /Platform không hợp lệ/, "platform lạ bị từ chối");
  await rejects(() => video.createVideo({ title: "a", assetUrl: "javascript:alert(1)" }, { actor: "founder" }), /http/, "URL không phải http(s) bị từ chối (chặn javascript:)");
  await rejects(() => video.createVideo({ title: "a", durationSec: 99999 }, { actor: "founder" }), /durationSec/, "durationSec ngoài khoảng bị từ chối");

  console.log("7. Thống kê & lọc");
  const stats = await video.getVideoStats();
  assert.strictEqual(stats.total, 2);
  assert.strictEqual(stats.byStatus.PUBLISHED, 1);
  assert.strictEqual(stats.byStatus.APPROVED, 1);
  assert.strictEqual(stats.totalCostUsd, 0.5);
  const found = await video.listVideos({ q: "DEMO" });
  assert.strictEqual(found.length, 1);
  log("stats + tìm kiếm theo tag không phân biệt hoa/thường");

  console.log("8. Suspended agent bị chặn");
  await fakeDb.agent.update({ where: { id: VIDEO_AGENT_ID }, data: { status: "SUSPENDED", suspendedReason: "FOUNDER_STOP" } });
  await rejects(() => call("tool_video_search", { operation: "list" }), /SUSPENDED/, "agent SUSPENDED không chạy được tool");

  console.log("\n✅ TẤT CẢ KIỂM TRA ĐẠT");
}

run().catch((e) => {
  console.error("\n❌ THẤT BẠI:", e);
  process.exit(1);
});
