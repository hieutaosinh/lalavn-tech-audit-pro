/**
 * Compare current audit with previous audit (read from JSON file).
 * Returns: new issues, fixed issues, persistent issues, score delta.
 */

import { readFile, access } from "node:fs/promises";

export async function loadPreviousReport(path) {
  try {
    await access(path);
    const text = await readFile(path, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function compareReports(current, previous) {
  if (!previous) return null;

  const cur = indexIssues(current.allIssues || []);
  const prev = indexIssues(previous.allIssues || []);

  const newIssues = [];
  const fixedIssues = [];
  const persistentIssues = [];

  for (const [k, v] of cur) {
    if (!prev.has(k)) newIssues.push(v);
    else persistentIssues.push(v);
  }
  for (const [k, v] of prev) {
    if (!cur.has(k)) fixedIssues.push(v);
  }

  const scoreDelta = (current.summary?.score ?? 0) - (previous.summary?.score ?? 0);

  return {
    previousDate: previous.auditDate,
    previousScore: previous.summary?.score ?? null,
    currentScore: current.summary?.score ?? null,
    scoreDelta,
    newIssues,
    fixedIssues,
    persistentIssues,
    counts: {
      new: newIssues.length,
      fixed: fixedIssues.length,
      persistent: persistentIssues.length,
    },
  };
}

function indexIssues(issues) {
  const map = new Map();
  for (const i of issues) {
    const key = `${i.code}::${i.url || ""}::${i.message || ""}`;
    if (!map.has(key)) map.set(key, i);
  }
  return map;
}
