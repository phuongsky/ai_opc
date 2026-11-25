import fs from "fs";
import path from "path";
import { resolveDataDir } from "../../config/env";
import { DEFAULT_FOUNDER_EMAIL } from "../../db/bootstrapFounder";

export interface CockpitNavButtonsConfig {
  showAgents: boolean;
  showHireAgent: boolean;
  showKnowledge: boolean;
  showSettings: boolean;
  showSecurity: boolean;
  defaultEmail: string;
}

const DEFAULT_COCKPIT_NAV_CONFIG: CockpitNavButtonsConfig = {
  showAgents: true,
  showHireAgent: true,
  showKnowledge: true,
  showSettings: true,
  showSecurity: true,
  defaultEmail: DEFAULT_FOUNDER_EMAIL,
};

function getConfigFile(): string {
  const dataDir = resolveDataDir();
  return path.join(dataDir, "cockpit_nav.json");
}

export function getCockpitNavConfig(userEmail?: string): CockpitNavButtonsConfig {
  const filePath = getConfigFile();
  let fileData: Partial<CockpitNavButtonsConfig> = {};

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      fileData = JSON.parse(raw);
    } catch (err) {
      console.warn("[cockpitNavConfig] Lỗi đọc cockpit_nav.json:", err);
    }
  }

  const isDefaultFounder =
    !userEmail || userEmail.trim().toLowerCase() === DEFAULT_FOUNDER_EMAIL.toLowerCase();

  // Luôn luôn hiển thị nút Settings với tài khoản Founder chính phuongtv2c11@gmail.com
  let showSettings = isDefaultFounder
    ? true
    : typeof fileData.showSettings === "boolean"
    ? fileData.showSettings
    : DEFAULT_COCKPIT_NAV_CONFIG.showSettings;

  return {
    showAgents:
      typeof fileData.showAgents === "boolean"
        ? fileData.showAgents
        : DEFAULT_COCKPIT_NAV_CONFIG.showAgents,
    showHireAgent:
      typeof fileData.showHireAgent === "boolean"
        ? fileData.showHireAgent
        : DEFAULT_COCKPIT_NAV_CONFIG.showHireAgent,
    showKnowledge:
      typeof fileData.showKnowledge === "boolean"
        ? fileData.showKnowledge
        : DEFAULT_COCKPIT_NAV_CONFIG.showKnowledge,
    showSettings,
    showSecurity:
      typeof fileData.showSecurity === "boolean"
        ? fileData.showSecurity
        : DEFAULT_COCKPIT_NAV_CONFIG.showSecurity,
    defaultEmail: DEFAULT_FOUNDER_EMAIL,
  };
}

export function updateCockpitNavConfig(
  partial: Partial<CockpitNavButtonsConfig>,
  userEmail?: string
): CockpitNavButtonsConfig {
  const current = getCockpitNavConfig(userEmail);
  const isDefaultFounder =
    !userEmail || userEmail.trim().toLowerCase() === DEFAULT_FOUNDER_EMAIL.toLowerCase();

  const updated: CockpitNavButtonsConfig = {
    showAgents:
      partial.showAgents !== undefined ? Boolean(partial.showAgents) : current.showAgents,
    showHireAgent:
      partial.showHireAgent !== undefined ? Boolean(partial.showHireAgent) : current.showHireAgent,
    showKnowledge:
      partial.showKnowledge !== undefined ? Boolean(partial.showKnowledge) : current.showKnowledge,
    showSettings: isDefaultFounder
      ? true
      : partial.showSettings !== undefined
      ? Boolean(partial.showSettings)
      : current.showSettings,
    showSecurity:
      partial.showSecurity !== undefined ? Boolean(partial.showSecurity) : current.showSecurity,
    defaultEmail: DEFAULT_FOUNDER_EMAIL,
  };

  try {
    const filePath = getConfigFile();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf-8");
  } catch (err) {
    console.error("[cockpitNavConfig] Lỗi ghi cockpit_nav.json:", err);
  }

  return updated;
}
