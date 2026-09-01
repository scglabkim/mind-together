export const BOARD_WIDTH = 4000;
export const BOARD_HEIGHT = 3000;
export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 66;
export const NODE_MAX_WIDTH = 340;
export const NODE_MAX_HEIGHT = 240;
export const COLORS = ["violet", "blue", "mint", "peach", "slate"];

export function createId(prefix = "node") {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random.replaceAll("-", "")}`;
}

export function cleanText(value, fallback = "새 아이디어", maxLength = 120) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, maxLength);
}

export function estimatedNodeSize(text) {
  const value = cleanText(text);
  const units = [...value].reduce((total, character) => total + (/[^\u0000-\u00ff]/.test(character) ? 1.75 : 1), 0);
  const width = clamp(Math.round(NODE_WIDTH + Math.max(0, units - 14) * 4.5), NODE_WIDTH, NODE_MAX_WIDTH);
  const usableUnitsPerLine = Math.max(12, (width - 66) / 8);
  const lines = Math.max(1, Math.ceil(units / usableUnitsPerLine));
  return { width, height: clamp(42 + lines * 20, NODE_HEIGHT, NODE_MAX_HEIGHT) };
}

export function nodeWidth(node) {
  return clamp(Number(node?.width) || NODE_WIDTH, NODE_WIDTH, NODE_MAX_WIDTH);
}

export function nodeHeight(node) {
  return clamp(Number(node?.height) || NODE_HEIGHT, NODE_HEIGHT, NODE_MAX_HEIGHT);
}

export function createNode({ id = createId(), text = "새 아이디어", x = 2000, y = 1500, parentId = null, color = "violet", width, height, now = Date.now() } = {}) {
  const normalizedText = cleanText(text);
  const estimatedSize = estimatedNodeSize(normalizedText);
  return {
    id,
    text: normalizedText,
    x: Math.round(Number(x) || 0),
    y: Math.round(Number(y) || 0),
    width: clamp(Number(width) || estimatedSize.width, NODE_WIDTH, NODE_MAX_WIDTH),
    height: clamp(Number(height) || estimatedSize.height, NODE_HEIGHT, NODE_MAX_HEIGHT),
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
    const width = nodeWidth(target);
    const height = nodeHeight(target);
    const inside = x >= target.x && x <= target.x + width && y >= target.y && y <= target.y + height;
    if (!inside) continue;
    const distance = Math.hypot(x - (target.x + width / 2), y - (target.y + height / 2));
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
      x: Number(value.x) || 0,
      y: Number(value.y) || 0,
      width: value.width,
      height: value.height,
      parentId: value.parentId,
      color: value.color,
      now: Number(value.updatedAt) || Date.now()
    });
    nodes[key].x = clamp(nodes[key].x, 0, BOARD_WIDTH - nodeWidth(nodes[key]));
    nodes[key].y = clamp(nodes[key].y, 0, BOARD_HEIGHT - nodeHeight(nodes[key]));
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

function edgeAnchor(node, toward) {
  const width = nodeWidth(node);
  const height = nodeHeight(node);
  const centerX = node.x + width / 2;
  const centerY = node.y + height / 2;
  const targetX = toward.x + nodeWidth(toward) / 2;
  const targetY = toward.y + nodeHeight(toward) / 2;
  const dx = targetX - centerX;
  const dy = targetY - centerY;
  const horizontalRatio = Math.abs(dx) / Math.max(width / 2, 1);
  const verticalRatio = Math.abs(dy) / Math.max(height / 2, 1);
  const scale = 1 / Math.max(horizontalRatio, verticalRatio, 0.0001);
  const horizontalSide = horizontalRatio >= verticalRatio;
  return {
    x: centerX + dx * scale,
    y: centerY + dy * scale,
    nx: horizontalSide ? Math.sign(dx) || 1 : 0,
    ny: horizontalSide ? 0 : Math.sign(dy) || 1
  };
}

export function edgeAnchors(parent, child) {
  return {
    start: edgeAnchor(parent, child),
    end: edgeAnchor(child, parent)
  };
}

export function edgePath(parent, child) {
  const { start, end } = edgeAnchors(parent, child);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const controlOffset = clamp(distance * 0.38, 48, 220);
  const c1x = start.x + start.nx * controlOffset;
  const c1y = start.y + start.ny * controlOffset;
  const c2x = end.x + end.nx * controlOffset;
  const c2y = end.y + end.ny * controlOffset;
  return `M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
