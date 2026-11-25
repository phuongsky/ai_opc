const esbuild = require("esbuild");
const path = require("path");

const optionalExternals = [
  "pg",
  "pg-native",
  "pg-query-stream",
  "mysql",
  "mysql2",
  "better-sqlite3",
  "sqlite3",
  "mariadb",
  "tedious",
  "oracledb",
  "mock-aws-s3",
  "aws-sdk",
  "nock",
  "../../node_modules/.prisma/client-mssql",
  "@prisma/client",
];

async function run() {
  console.log("[bundle] Đang đóng gói toàn bộ services/api bằng esbuild...");
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, "../src/index.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: path.resolve(__dirname, "../dist/bundle.js"),
    external: optionalExternals,
    mainFields: ["main", "module"],
    define: {
      "import.meta.url": "import_meta_url",
    },
    banner: {
      js: `
const { pathToFileURL: _pathToFileURL } = require('url');
const import_meta_url = _pathToFileURL(__filename).href;
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {};
}
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {};
}
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D {};
}
if (typeof globalThis.DOMPoint === 'undefined') {
  globalThis.DOMPoint = class DOMPoint {};
}
`,
    },
    logLevel: "info",
  });
  console.log("[bundle] ✓ services/api đã được đóng gói thành công: services/api/dist/bundle.js");
}

run().catch((err) => {
  console.error("[bundle] Lỗi đóng gói:", err);
  process.exit(1);
});
