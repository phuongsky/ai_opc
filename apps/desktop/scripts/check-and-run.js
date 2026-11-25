/**
 * Smart CLI Wrapper for Tauri (AI-OPC Desktop)
 * Tự động phát hiện Cargo/Rust & MSVC C++ Build Tools (link.exe, Windows SDK) trong PATH hoặc các thư mục hệ thống.
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

function getCargoPath() {
  // 1. Kiểm tra trong PATH hiện tại
  try {
    const cmd = process.platform === "win32" ? "where.exe cargo" : "which cargo";
    const res = spawnSync(cmd, { shell: true, encoding: "utf-8" });
    if (res.status === 0 && res.stdout.trim()) {
      return "path";
    }
  } catch {}

  // 2. Kiểm tra trong thư mục ~/.cargo/bin mặc định
  const cargoBinDir = path.join(os.homedir(), ".cargo", "bin");
  const cargoExe = process.platform === "win32" ? path.join(cargoBinDir, "cargo.exe") : path.join(cargoBinDir, "cargo");

  if (fs.existsSync(cargoExe)) {
    return cargoBinDir;
  }

  return null;
}

function loadMsvcEnvironment() {
  if (process.platform !== "win32") return;

  // Danh sách đường dẫn vcvars64.bat tiềm năng
  const candidates = [
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat",
  ];

  // Tìm kiếm tự động qua vswhere
  const vswhereExe = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
  if (fs.existsSync(vswhereExe)) {
    try {
      const vsRes = spawnSync(`"${vswhereExe}" -all -property installationPath`, { shell: true, encoding: "utf-8" });
      if (vsRes.status === 0 && vsRes.stdout) {
        const paths = vsRes.stdout.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
        for (const p of paths) {
          const bat = path.join(p, "VC", "Auxiliary", "Build", "vcvars64.bat");
          if (fs.existsSync(bat) && !candidates.includes(bat)) {
            candidates.unshift(bat);
          }
        }
      }
    } catch {}
  }

  for (const bat of candidates) {
    if (fs.existsSync(bat)) {
      try {
        const res = spawnSync(`cmd.exe /c "call "${bat}" >nul 2>&1 && set"`, {
          shell: true,
          encoding: "utf-8",
        });
        if (res.status === 0 && res.stdout) {
          const lines = res.stdout.split(/\r?\n/);
          for (const line of lines) {
            const idx = line.indexOf("=");
            if (idx > 0) {
              const key = line.substring(0, idx);
              const val = line.substring(idx + 1);
              process.env[key] = val;
            }
          }
          console.log(`[AI-OPC Desktop] ✓ Tự động nạp MSVC C++ Toolchain từ: ${path.basename(path.dirname(path.dirname(path.dirname(bat))))}`);
          return;
        }
      } catch (err) {
        console.warn("[AI-OPC Desktop] Cảnh báo khi nạp vcvars64:", err);
      }
    }
  }
}

function isLinkerAvailable() {
  if (process.platform !== "win32") return true;
  try {
    const res = spawnSync("where.exe link.exe", { shell: true, encoding: "utf-8", env: process.env });
    return res.status === 0 && res.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function ensureEnvironment() {
  const cargoLocation = getCargoPath();

  if (!cargoLocation) {
    console.error(`
================================================================================
⚠️  [AI-OPC Desktop] CHƯA TÌM THẤY RUST TOOLCHAIN (CARGO / RUSTC)
================================================================================
Tauri yêu cầu Rust compiler để biên dịch ứng dụng Desktop native (tệp .exe / MSI / App).

👉 HƯỚNG DẪN CÀI ĐẶT RUST NHANH:
1. Mở PowerShell / Terminal và chạy lệnh sau:
   winget install --id Rustlang.Rustup -e
   (hoặc tải bộ cài chính thức tại: https://rustup.rs/)

2. Sau khi cài xong, chạy lại lệnh:
   pnpm build:desktop
================================================================================
`);
    process.exit(1);
  }

  // Nếu cargo nằm trong ~/.cargo/bin nhưng chưa nạp vào PATH phiên hiện tại
  if (cargoLocation !== "path") {
    const pathSeparator = process.platform === "win32" ? ";" : ":";
    process.env.PATH = `${cargoLocation}${pathSeparator}${process.env.PATH}`;
  }

  // Nạp MSVC Linker & C++ build tools trên Windows
  loadMsvcEnvironment();

  // In thông tin Rust version đã nhận diện
  try {
    const versionRes = spawnSync("cargo", ["--version"], { shell: true, encoding: "utf-8", env: process.env });
    if (versionRes.status === 0) {
      console.log(`[AI-OPC Desktop] ✓ Sẵn sàng: ${versionRes.stdout.trim()}`);
    }
  } catch {}

  // Kiểm tra Linker C++ trên Windows
  if (!isLinkerAvailable()) {
    console.error(`
================================================================================
⚠️  [AI-OPC Desktop] CHƯA TÌM THẤY C++ BUILD TOOLS (link.exe / Windows SDK)
================================================================================
Tauri (Rust) trên Windows yêu cầu C++ Build Tools & Windows SDK để liên kết file .exe.

👉 HƯỚNG DẪN BẬT / CÀI ĐẶT C++ BUILD TOOLS:
1. Mở ứng dụng "Visual Studio Installer" trên máy tính của bạn.
2. Tại mục Visual Studio 2022 (Community hoặc Build Tools), bấm nút "Modify" (Sửa đổi).
3. Tích chọn workload: "Desktop development with C++" (Phát triển ứng dụng C++ cho máy tính).
4. Bấm "Modify / Install" ở góc dưới để bắt đầu cài đặt.
5. Sau khi hoàn tất, chạy lại lệnh:
   pnpm build:desktop
================================================================================
`);
    process.exit(1);
  }
}

function ensureSidecar(isBuild = false) {
  const binariesDir = path.resolve(__dirname, "../src-tauri/binaries");
  const dataDir = path.join(binariesDir, "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 1. Tự động chuẩn hóa Founder account vào DB mẫu trước khi copy
  const rootDir = path.resolve(__dirname, "../../..");
  try {
    spawnSync("pnpm --filter @ai-opc/api bootstrap:founder", { shell: true, stdio: "ignore", cwd: rootDir });
  } catch {}

  const targetDb = path.join(dataDir, "company_os.db");
  const candidateSrcDbs = [
    path.resolve(__dirname, "../../../services/api/src/db/prisma/data/company_os.db"),
    path.resolve(__dirname, "../../../services/api/data/company_os.db"),
  ];
  for (const srcDb of candidateSrcDbs) {
    if (fs.existsSync(srcDb) && fs.statSync(srcDb).size > 0) {
      try {
        fs.copyFileSync(srcDb, targetDb);
        console.log(`[AI-OPC Desktop] ✓ Đã đồng bộ cơ sở dữ liệu mẫu từ ${path.relative(__dirname, srcDb)} vào binaries`);
      } catch {}
      break;
    }
  }

  const targetPrefs = path.join(dataDir, "notification_preferences.json");
  const srcPrefs = path.resolve(__dirname, "../../../services/api/data/notification_preferences.json");
  if (fs.existsSync(srcPrefs)) {
    try {
      fs.copyFileSync(srcPrefs, targetPrefs);
      console.log("[AI-OPC Desktop] ✓ Đã đồng bộ notification_preferences.json mẫu vào binaries");
    } catch {}
  }

  // 2. Đồng bộ Prisma native engine DLL
  const targetEngine = path.join(binariesDir, "query_engine-windows.dll.node");
  const candidateEngines = [
    path.resolve(__dirname, "../../../services/api/node_modules/.prisma/client-sqlite/query_engine-windows.dll.node"),
    path.resolve(__dirname, "../../../node_modules/.pnpm/@prisma+engines@5.22.0/node_modules/@prisma/engines/query_engine-windows.dll.node"),
  ];
  for (const cand of candidateEngines) {
    if (fs.existsSync(cand)) {
      try {
        fs.copyFileSync(cand, targetEngine);
        console.log("[AI-OPC Desktop] ✓ Đã đồng bộ Prisma Query Engine native DLL vào binaries");
      } catch {}
      break;
    }
  }

  // 3. Tự động đóng gói Sidecar Binary
  // Nếu là lệnh "build" hoặc file binary chưa tồn tại -> luôn build lại để đảm bảo cập nhật code mới nhất
  const sidecarExe = path.join(binariesDir, "api-server-x86_64-pc-windows-msvc.exe");
  const needsBuild = isBuild || !fs.existsSync(sidecarExe) || fs.statSync(sidecarExe).size === 0;

  if (needsBuild) {
    console.log("[AI-OPC Desktop] Đang tự động đóng gói Sidecar Backend Engine (.exe)...");
    const rootDir = path.resolve(__dirname, "../../..");
    const bundleRes = spawnSync("node services/api/scripts/bundle.js", { shell: true, stdio: "inherit", cwd: rootDir });
    if (bundleRes.status !== 0) {
      console.error("[AI-OPC Desktop] Lỗi khi bundle services/api!");
      process.exit(1);
    }
    const pkgRes = spawnSync("npx --yes @yao-pkg/pkg services/api/dist/bundle.js --target node22-win-x64 --output apps/desktop/src-tauri/binaries/api-server-x86_64-pc-windows-msvc.exe", {
      shell: true,
      stdio: "inherit",
      cwd: rootDir,
    });
    if (pkgRes.status !== 0) {
      console.error("[AI-OPC Desktop] Lỗi khi tạo binary qua pkg!");
      process.exit(1);
    }
    console.log("[AI-OPC Desktop] ✓ Sidecar Backend Engine đã được đóng gói thành công!");
  }
}

function cleanStaleProcesses() {
  if (process.platform !== "win32") return;
  const targetProcesses = [
    "ai-opc-desktop.exe",
    "api-server-x86_64-pc-windows-msvc.exe",
    "AI-OPC Company OS_0.1.0_x64-setup.exe",
  ];
  for (const proc of targetProcesses) {
    try {
      spawnSync(`taskkill /F /T /IM "${proc}"`, { shell: true, stdio: "ignore" });
    } catch {}
  }
}

function cleanBundleOutput() {
  const bundleDir = path.resolve(__dirname, "../src-tauri/target/release/bundle");
  if (fs.existsSync(bundleDir)) {
    try {
      fs.rmSync(bundleDir, { recursive: true, force: true });
      console.log("[AI-OPC Desktop] ✓ Đã dọn dẹp thư mục bundle cũ trước khi build");
    } catch (err) {
      console.warn("[AI-OPC Desktop] ⚠️ Cảnh báo dọn dẹp thư mục bundle:", err.message);
    }
  }
}

function runTauri() {
  const args = process.argv.slice(2);
  const isBuild = args.includes("build");

  if (isBuild) {
    cleanStaleProcesses();
    cleanBundleOutput();
  }

  ensureEnvironment();
  ensureSidecar(isBuild);

  const tauriCli = path.resolve(__dirname, "../node_modules/.bin", process.platform === "win32" ? "tauri.cmd" : "tauri");

  const executable = fs.existsSync(tauriCli) ? tauriCli : "tauri";

  const result = spawnSync(executable, args, {
    stdio: "inherit",
    shell: true,
    env: process.env,
    cwd: path.resolve(__dirname, ".."),
  });

  if (result.status === 0 && isBuild) {
    const nsisExe = path.resolve(__dirname, "../src-tauri/target/release/bundle/nsis/AI-OPC Company OS_0.1.0_x64-setup.exe");
    if (fs.existsSync(nsisExe)) {
      const sizeMb = (fs.statSync(nsisExe).size / (1024 * 1024)).toFixed(2);
      console.log(`
================================================================================
🎉 [AI-OPC Desktop] ĐÓNG GÓI BỘ CÀI WINDOWS THÀNH CÔNG!
================================================================================
📁 File cài đặt (.exe):
   ${nsisExe} (${sizeMb} MB)

💡 Bạn có thể nhấp đúp vào file trên để tiến hành cài đặt ứng dụng Desktop.
================================================================================
`);
    }
  }

  process.exit(result.status ?? 0);
}

runTauri();

