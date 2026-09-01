export const BOARD_WIDTH = 4000;
export const BOARD_HEIGHT = 3000;
export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 66;
export const COLORS = ["violet", "blue", "mint", "peach", "slate"];

export function createId(prefix = "node") {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random.replaceAll("-", "")}`;
}

export function cleanText(value, fallback = "새 아이디어", maxLength = 120) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, maxLength);
}

export function createNode({ id = createId(), text = "새 아이디어", x = 2000, y = 1500, parentId = null, color = "violet", now = Date.now() } = {}) {
  return {
    id,
    text: cleanText(text),
    x: Math.round(Number(x) || 0),
    y: Math.round(Number(y) || 0),
    parentId: parentId || null,
    color: COLORS.includes(color) ? color : "violet",
    createdAt: now,
    updatedAt: now
  };
}

export function createBoard(roomId, now = Date.now()) {
  const root = createNode({ id: "root", text: "중심 아이디어", x: 1905, y: 1467, color: "violet", now });
  return {
    id: roomId,
    title: "새 마인드맵",
    nodes: { root },
    createdAt: now,
    updatedAt: now
  };
}

export function childPosition(nodes, parent) {
  const siblings = Object.values(nodes).filter((node) => node.parentId === parent.id);
  const index = siblings.length;
  const direction = index % 2 === 0 ? 1 : -1;
  const row = Math.floor(index / 2);
  return {
    x: clamp(parent.x + direction * (280 + row * 55), 40, BOARD_WIDTH - NODE_WIDTH - 40),
    y: clamp(parent.y + (index % 4 < 2 ? -1 : 1) * (110 + row * 76), 40, BOARD_HEIGHT - NODE_HEIGHT - 40)
  };
}

export function descendants(nodes, nodeId) {
  const result = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of Object.values(nodes)) {
      if (node.parentId && result.has(node.parentId) && !result.has(node.id)) {
        result.add(node.id);
        changed = true;
      }
    }
  }
  return result;
}

export function canReparent(nodes, nodeId, targetId) {
  if (nodeId === "root" || nodeId === targetId || !nodes[nodeId] || !nodes[targetId]) return false;
  return !descendants(nodes, nodeId).has(targetId);
}

export function dropTargetAt(nodes, nodeId, x, y) {
  let closest = null;
  let closestDistance = Infinity;
  for (const target of Object.values(nodes)) {
    if (!canReparent(nodes, nodeId, target.id)) continue;
    const inside = x >= target.x && x <= target.x + NODE_WIDTH && y >= target.y && y <= target.y + NODE_HEIGHT;
    if (!inside) continue;
    const distance = Math.hypot(x - (target.x + NODE_WIDTH / 2), y - (target.y + NODE_HEIGHT / 2));
    if (distance < closestDistance) {
      closest = target.id;
      closestDistance = distance;
    }
  }
  return closest;
}

export function normalizeBoard(raw, roomId) {
  const fallback = createBoard(roomId);
  if (!raw || typeof raw !== "object") return fallback;
  const nodes = {};
  for (const [key, value] of Object.entries(raw.nodes ?? {})) {
    if (!value || typeof value !== "object") continue;
    nodes[key] = createNode({
      id: key,
      text: value.text,
      x: clamp(Number(value.x) || 0, 0, BOARD_WIDTH - NODE_WIDTH),
      y: clamp(Number(value.y) || 0, 0, BOARD_HEIGHT - NODE_HEIGHT),
      parentId: value.parentId,
      color: value.color,
      now: Number(value.updatedAt) || Date.now()
    });
    nodes[key].createdAt = Number(value.createdAt) || nodes[key].updatedAt;
  }
  if (!nodes.root) nodes.root = fallback.nodes.root;
  return {
    id: roomId,
    title: cleanText(raw.title, "새 마인드맵", 60),
    nodes,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now()
  };
}

export function edgePath(parent, child) {
  const parentCenterX = parent.x + NODE_WIDTH / 2;
  const parentCenterY = parent.y + NODE_HEIGHT / 2;
  const childCenterX = child.x + NODE_WIDTH / 2;
  const childCenterY = child.y + NODE_HEIGHT / 2;
  const movingRight = childCenterX >= parentCenterX;
  const startX = parent.x + (movingRight ? NODE_WIDTH : 0);
  const endX = child.x + (movingRight ? 0 : NODE_WIDTH);
  const controlOffset = Math.max(60, Math.abs(endX - startX) * 0.45);
  const c1x = startX + (movingRight ? controlOffset : -controlOffset);
  const c2x = endX + (movingRight ? -controlOffset : controlOffset);
  return `M ${startX} ${parentCenterY} C ${c1x} ${parentCenterY}, ${c2x} ${childCenterY}, ${endX} ${childCenterY}`;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
