import type { PermissionLevel, RiskLevel } from "@ai-opc/shared";

const PERMISSION_ORDER: PermissionLevel[] = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"];
const RISK_ORDER: RiskLevel[] = ["R0", "R1", "R2", "R3", "R4"];

export function permissionRank(level: PermissionLevel): number {
  return PERMISSION_ORDER.indexOf(level);
}

export function riskRank(level: RiskLevel): number {
  return RISK_ORDER.indexOf(level);
}

/** L5/L6 luôn cần Founder duyệt, bất kể tool có gắn requiresApproval hay không. */
export function permissionRequiresApproval(level: PermissionLevel): boolean {
  return permissionRank(level) >= permissionRank("L5");
}

/** Risk R3/R4 luôn cần Founder duyệt (Rule 5), bất kể permission level. */
export function riskRequiresApproval(level: RiskLevel): boolean {
  return riskRank(level) >= riskRank("R3");
}

export function hasNoPermission(level: PermissionLevel | null | undefined): boolean {
  return !level || level === "L0";
}
