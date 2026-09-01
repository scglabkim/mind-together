import {
  NODE_WIDTH,
  NODE_HEIGHT,
  NODE_MAX_WIDTH,
  NODE_MAX_HEIGHT,
  COLORS,
  createId,
  createNode,
  createBoard,
  childPosition,
  rootPosition,
  cleanText,
  descendants,
  visibleNodeIds,
  translateBranch,
  dropTargetAt,
  edgePath,
  normalizeBoard,
  nodeWidth,
  nodeHeight,
  clamp
} from "./model.js?v=20260901-6";

const FIREBASE_VERSION = "12.18.0";
const roomMatch = location.hash.match(/^#\/room\/([a-zA-Z0-9_-]{20,80})$/);
const roomId = roomMatch?.[1] ?? null;
const storageKey = roomId ? `mind-together:${roomId}` : null;
const recentRoomsKey = "mind-together:recent-rooms";
const colorLabels = { violet: "보라", blue: "파랑", mint: "민트", peach: "주황", slate: "회색" };

const elements = {
  welcome: document.querySelector("#welcome"),
  createBoard: document.querySelector("#create-board"),
  roomsButton: document.querySelector("#rooms-button"),
  roomsPanel: document.querySelector("#rooms-panel"),
  roomList: document.querySelector("#room-list"),
  welcomeRecent: document.querySelector("#welcome-recent"),
  welcomeRoomList: document.querySelector("#welcome-room-list"),
  boardTitle: document.querySelector("#board-title"),
  canvas: document.querySelector("#canvas"),
  viewport: document.querySelector("#viewport"),
  nodes: document.querySelector("#nodes"),
  edges: document.querySelector("#edges"),
  addNode: document.querySelector("#add-node"),
  addRoot: document.querySelector("#add-root"),
  editNode: document.querySelector("#edit-node"),
  deleteNode: document.querySelector("#delete-node"),
  zoomIn: document.querySelector("#zoom-in"),
  zoomOut: document.querySelector("#zoom-out"),
  fitView: document.querySelector("#fit-view"),
  shareButton: document.querySelector("#share-button"),
  toast: document.querySelector("#toast"),
  connectionStatus: document.querySelector("#connection-status"),
  connectionLabel: document.querySelector("#connection-label"),
  presenceDots: document.querySelector(".presence-dots"),
  presenceLabel: document.querySelector("#presence-label")
};

let board = roomId ? loadLocalBoard() : null;
let selectedId = "root";
let editingId = null;
let editingOriginalText = "";
let editingOriginalSize = null;
let transform = { x: 0, y: 0, scale: 1 };
let interaction = null;
let colorPickerId = null;
let remote = null;
let isApplyingRemote = false;
let toastTimer = null;

if (roomId) {
  elements.welcome.classList.add("hidden");
  persistLocal();
  rememberCurrentRoom();
  render();
  requestAnimationFrame(() => fitView(true));
  connectFirebase().catch((error) => {
    console.warn("Firebase 연결 실패, 로컬 모드로 전환합니다.", error);
    setConnection("local", "이 브라우저에 저장 중");
  });
}

renderRoomLists();

elements.createBoard.addEventListener("click", () => {
  const newRoomId = createId("room");
  location.hash = `/room/${newRoomId}`;
  location.reload();
});

elements.addNode.addEventListener("click", addChildNode);
elements.addRoot.addEventListener("click", addRootNode);
elements.editNode.addEventListener("click", () => startInlineEdit());
elements.deleteNode.addEventListener("click", deleteSelected);
elements.zoomIn.addEventListener("click", () => zoomBy(1.16));
elements.zoomOut.addEventListener("click", () => zoomBy(0.86));
elements.fitView.addEventListener("click", () => fitView(false));
elements.shareButton.addEventListener("click", shareBoard);
elements.roomsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const willOpen = elements.roomsPanel.classList.contains("hidden");
  closeColorPicker();
  elements.roomsPanel.classList.toggle("hidden", !willOpen);
  elements.roomsButton.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) renderRoomLists();
});
elements.roomsPanel.addEventListener("pointerdown", (event) => event.stopPropagation());
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".rooms-panel, .rooms-button")) closeRoomsPanel();
  if (!event.target.closest(".node-dot, .node-palette")) closeColorPicker();
});

elements.boardTitle.addEventListener("change", () => {
  if (!board) return;
  board.title = cleanText(elements.boardTitle.value, "새 마인드맵", 60);
  elements.boardTitle.value = board.title;
  touchBoard();
  saveTitle();
});

elements.canvas.addEventListener("pointerdown", onCanvasPointerDown);
elements.canvas.addEventListener("pointermove", onPointerMove);
elements.canvas.addEventListener("pointerup", onPointerUp);
elements.canvas.addEventListener("pointercancel", onPointerUp);
elements.canvas.addEventListener("dblclick", onCanvasDoubleClick);
elements.canvas.addEventListener("wheel", onWheel, { passive: false });

document.addEventListener("keydown", (event) => {
  if (!roomId || editingId) return;
  if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (event.key === "Tab") {
    event.preventDefault();
    addChildNode();
  } else if (event.key === "Enter") {
    event.preventDefault();
    startInlineEdit();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelected();
  } else if (event.key === "Escape") {
    selectedId = "root";
    render();
  }
});

window.addEventListener("hashchange", () => location.reload());
window.addEventListener("beforeunload", () => remote?.disconnect?.());

function loadLocalBoard() {
  try {
    return normalizeBoard(JSON.parse(localStorage.getItem(storageKey)), roomId);
  } catch {
    return createBoard(roomId);
  }
}

function persistLocal() {
  if (!board || !storageKey || isApplyingRemote) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(board));
  } catch (error) {
    console.warn("브라우저 저장소에 마인드맵을 저장하지 못했습니다.", error);
  }
}

function touchBoard() {
  board.updatedAt = Date.now();
  persistLocal();
  rememberCurrentRoom();
  renderRoomLists();
}

function readRecentRooms() {
  let recent = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(recentRoomsKey));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) recent = parsed;
  } catch {
    recent = {};
  }

  // 이전 버전에서 이미 열었던 룸도 첫 사용 시 자동으로 목록에 포함한다.
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith("mind-together:room-")) continue;
    const savedRoomId = key.slice("mind-together:".length);
    if (recent[savedRoomId]) continue;
    try {
      const savedBoard = JSON.parse(localStorage.getItem(key));
      recent[savedRoomId] = { lastOpenedAt: Number(savedBoard?.updatedAt) || Date.now() };
    } catch {
      recent[savedRoomId] = { lastOpenedAt: Date.now() };
    }
  }
  return recent;
}

function rememberCurrentRoom() {
  if (!roomId) return;
  const recent = readRecentRooms();
  recent[roomId] = { lastOpenedAt: Date.now() };
  try {
    localStorage.setItem(recentRoomsKey, JSON.stringify(recent));
  } catch (error) {
    console.warn("최근 마인드맵 목록을 저장하지 못했습니다.", error);
  }
}

function roomSummaries() {
  const recent = readRecentRooms();
  return Object.entries(recent).map(([savedRoomId, metadata]) => {
    let savedBoard = null;
    try {
      savedBoard = JSON.parse(localStorage.getItem(`mind-together:${savedRoomId}`));
    } catch {
      savedBoard = null;
    }
    const root = Object.values(savedBoard?.nodes ?? {}).find((node) => node?.parentId === null);
    return {
      roomId: savedRoomId,
      title: cleanText(savedBoard?.title, "새 마인드맵", 60),
      rootText: cleanText(root?.text, "중심 아이디어", 120),
      lastOpenedAt: Number(metadata?.lastOpenedAt) || Number(savedBoard?.updatedAt) || 0
    };
  }).filter((summary) => /^room-[a-zA-Z0-9_-]{20,80}$/.test(summary.roomId))
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

function createRoomList(container, summaries) {
  container.replaceChildren();
  if (!summaries.length) {
    const empty = document.createElement("div");
    empty.className = "room-empty";
    empty.textContent = "아직 저장된 마인드맵이 없어요.";
    container.append(empty);
    return;
  }
  const dateFormatter = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  summaries.forEach((summary) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `room-item${summary.roomId === roomId ? " current" : ""}`;
    item.dataset.roomId = summary.roomId;
    const title = document.createElement("span");
    title.className = "room-item-title";
    title.textContent = summary.title;
    const root = document.createElement("span");
    root.className = "room-item-root";
    root.textContent = summary.rootText;
    const time = document.createElement("span");
    time.className = "room-item-time";
    time.textContent = summary.lastOpenedAt ? dateFormatter.format(new Date(summary.lastOpenedAt)) : "";
    item.append(title, root, time);
    item.addEventListener("click", () => {
      closeRoomsPanel();
      if (summary.roomId === roomId) return;
      location.hash = `/room/${summary.roomId}`;
    });
    container.append(item);
  });
}

function renderRoomLists() {
  const summaries = roomSummaries();
  createRoomList(elements.roomList, summaries);
  createRoomList(elements.welcomeRoomList, summaries);
  elements.welcomeRecent.classList.toggle("hidden", summaries.length === 0);
}

function closeRoomsPanel() {
  elements.roomsPanel.classList.add("hidden");
  elements.roomsButton.setAttribute("aria-expanded", "false");
}

function render() {
  if (!board) return;
  const visibleIds = visibleNodeIds(board.nodes);
  if (!visibleIds.has(selectedId)) selectedId = "root";
  elements.boardTitle.value = board.title;
  elements.nodes.replaceChildren();
  elements.edges.replaceChildren();

  for (const node of Object.values(board.nodes)) {
    if (visibleIds.has(node.id) && node.parentId && visibleIds.has(node.parentId) && board.nodes[node.parentId]) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", edgePath(board.nodes[node.parentId], node));
      path.setAttribute("class", `edge edge-${node.color}`);
      path.dataset.childId = node.id;
      elements.edges.append(path);
    }
  }

  for (const node of Object.values(board.nodes)) {
    if (!visibleIds.has(node.id)) continue;
    const childCount = Object.values(board.nodes).filter((candidate) => candidate.parentId === node.id).length;
    const hiddenCount = descendants(board.nodes, node.id).size - 1;
    const nodeElement = document.createElement("div");
    nodeElement.tabIndex = 0;
    nodeElement.setAttribute("role", "button");
    nodeElement.className = `mind-node color-${node.color}${selectedId === node.id ? " selected" : ""}${node.parentId === null ? " root-node" : ""}${editingId === node.id ? " editing" : ""}${childCount ? " has-children" : ""}`;
    nodeElement.dataset.nodeId = node.id;
    nodeElement.setAttribute("aria-pressed", String(selectedId === node.id));
    nodeElement.style.transform = `translate(${node.x}px, ${node.y}px)`;
    nodeElement.style.width = `${nodeWidth(node)}px`;
    nodeElement.style.height = `${nodeHeight(node)}px`;
    nodeElement.innerHTML = `<span class="node-dot" role="button" tabindex="0" aria-label="${colorLabels[node.color]} 색상 변경"></span><span class="node-copy"></span><span class="node-collapse" role="button"></span><span class="node-add" aria-hidden="true">＋</span><span class="node-palette${colorPickerId === node.id ? " visible" : ""}" role="menu" aria-label="노드 색상"></span>`;
    const dotElement = nodeElement.querySelector(".node-dot");
    const paletteElement = nodeElement.querySelector(".node-palette");
    dotElement.addEventListener("pointerdown", (event) => event.stopPropagation());
    dotElement.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedId = node.id;
      colorPickerId = colorPickerId === node.id ? null : node.id;
      render();
    });
    dotElement.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      selectedId = node.id;
      colorPickerId = colorPickerId === node.id ? null : node.id;
      render();
    });
    paletteElement.addEventListener("pointerdown", (event) => event.stopPropagation());
    COLORS.forEach((color) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = `color-swatch color-${color}${node.color === color ? " selected" : ""}`;
      swatch.setAttribute("role", "menuitem");
      swatch.setAttribute("aria-label", `${colorLabels[color]}색으로 변경`);
      swatch.title = colorLabels[color];
      swatch.addEventListener("pointerdown", (event) => event.stopPropagation());
      swatch.addEventListener("click", (event) => {
        event.stopPropagation();
        changeNodeColor(node.id, color);
      });
      paletteElement.append(swatch);
    });
    const copyElement = nodeElement.querySelector(".node-copy");
    if (editingId === node.id) {
      const input = document.createElement("textarea");
      input.className = "node-inline-editor";
      input.rows = 1;
      input.maxLength = 120;
      input.value = node.text;
      input.setAttribute("aria-label", `${node.text} 수정`);
      input.addEventListener("pointerdown", (event) => event.stopPropagation());
      input.addEventListener("click", (event) => event.stopPropagation());
      input.addEventListener("dblclick", (event) => event.stopPropagation());
      input.addEventListener("input", () => resizeInlineEditor(input, node, nodeElement));
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finishInlineEdit(input.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finishInlineEdit(editingOriginalText, true);
        }
      });
      input.addEventListener("blur", () => finishInlineEdit(input.value));
      copyElement.replaceWith(input);
      requestAnimationFrame(() => resizeInlineEditor(input, node, nodeElement));
    } else {
      copyElement.textContent = node.text;
    }
    nodeElement.setAttribute("aria-label", `${node.text} 아이디어`);
    const collapseElement = nodeElement.querySelector(".node-collapse");
    if (childCount) {
      collapseElement.textContent = node.collapsed ? `+${hiddenCount}` : "−";
      collapseElement.setAttribute("aria-label", node.collapsed ? `${hiddenCount}개 하위 아이디어 펼치기` : "하위 아이디어 접기");
      collapseElement.title = node.collapsed ? "하위 아이디어 펼치기" : "하위 아이디어 접기";
      collapseElement.addEventListener("pointerdown", (event) => event.stopPropagation());
      collapseElement.addEventListener("click", (event) => {
        event.stopPropagation();
        selectedId = node.id;
        toggleNodeCollapse(node.id);
      });
    } else {
      collapseElement.hidden = true;
    }
    nodeElement.querySelector(".node-add").addEventListener("pointerdown", (event) => event.stopPropagation());
    nodeElement.querySelector(".node-add").addEventListener("click", (event) => {
      event.stopPropagation();
      selectedId = node.id;
      addChildNode();
    });
    elements.nodes.append(nodeElement);
  }
  applyTransform();
}

function toggleNodeCollapse(nodeId) {
  const node = board?.nodes[nodeId];
  if (!node) return;
  node.collapsed = !node.collapsed;
  node.updatedAt = Date.now();
  touchBoard();
  render();
  saveNode(node);
}

function changeNodeColor(nodeId, color) {
  const node = board?.nodes[nodeId];
  if (!node || !COLORS.includes(color)) return;
  colorPickerId = null;
  if (node.color === color) {
    render();
    return;
  }
  node.color = color;
  node.updatedAt = Date.now();
  touchBoard();
  render();
  saveNode(node);
}

function closeColorPicker() {
  if (!colorPickerId) return;
  colorPickerId = null;
  elements.nodes.querySelectorAll(".node-palette.visible").forEach((palette) => palette.classList.remove("visible"));
}

function applyTransform() {
  elements.viewport.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
}

function updateNodeSelection() {
  elements.nodes.querySelectorAll(".mind-node").forEach((nodeElement) => {
    const selected = nodeElement.dataset.nodeId === selectedId;
    nodeElement.classList.toggle("selected", selected);
    nodeElement.setAttribute("aria-pressed", String(selected));
  });
}

function updateBoardGeometry() {
  elements.nodes.querySelectorAll(".mind-node").forEach((nodeElement) => {
    const node = board.nodes[nodeElement.dataset.nodeId];
    if (node) {
      nodeElement.style.transform = `translate(${node.x}px, ${node.y}px)`;
      nodeElement.style.width = `${nodeWidth(node)}px`;
      nodeElement.style.height = `${nodeHeight(node)}px`;
    }
  });
  elements.edges.querySelectorAll(".edge").forEach((path) => {
    const child = board.nodes[path.dataset.childId];
    const parent = child && board.nodes[child.parentId];
    if (parent) path.setAttribute("d", edgePath(parent, child));
  });
}

function preferredEditorWidth(input) {
  const context = preferredEditorWidth.context ??= document.createElement("canvas").getContext("2d");
  context.font = getComputedStyle(input).font;
  const textWidth = context.measureText(input.value || "새 아이디어").width;
  return clamp(Math.ceil(textWidth + 78), NODE_WIDTH, NODE_MAX_WIDTH);
}

function resizeInlineEditor(input, node, nodeElement) {
  node.width = preferredEditorWidth(input);
  nodeElement.style.width = `${node.width}px`;
  input.style.height = "1px";
  node.height = clamp(input.scrollHeight + 36, NODE_HEIGHT, NODE_MAX_HEIGHT);
  input.style.height = `${Math.max(24, node.height - 34)}px`;
  nodeElement.style.height = `${node.height}px`;
  updateBoardGeometry();
}

function updateDropTarget(targetId = null) {
  elements.nodes.querySelectorAll(".mind-node").forEach((nodeElement) => {
    nodeElement.classList.toggle("drop-target", nodeElement.dataset.nodeId === targetId);
    nodeElement.classList.toggle("dragging", nodeElement.dataset.nodeId === selectedId && Boolean(interaction?.moved));
  });
}

function addChildNode() {
  if (!board) return;
  const parent = board.nodes[selectedId] ?? board.nodes.root;
  const wasCollapsed = parent.collapsed;
  parent.collapsed = false;
  const position = childPosition(board.nodes, parent);
  const childCount = Object.values(board.nodes).filter((node) => node.parentId === parent.id).length;
  const palette = ["blue", "mint", "peach", "slate", "violet"];
  const node = createNode({
    text: "새 아이디어",
    x: position.x,
    y: position.y,
    parentId: parent.id,
    color: palette[childCount % palette.length]
  });
  board.nodes[node.id] = node;
  selectedId = node.id;
  touchBoard();
  render();
  if (wasCollapsed) {
    parent.updatedAt = Date.now();
    saveNodes([parent, node]);
  } else {
    saveNode(node);
  }
  startInlineEdit(true);
}

function addRootNode() {
  if (!board) return;
  const position = rootPosition(board.nodes);
  const node = createNode({
    text: "중심 아이디어",
    x: position.x,
    y: position.y,
    parentId: null,
    color: "violet"
  });
  board.nodes[node.id] = node;
  selectedId = node.id;
  touchBoard();
  render();
  saveNode(node);
  startInlineEdit(true);
}

function startInlineEdit(selectAll = false) {
  const node = board?.nodes[selectedId];
  if (!node || editingId) return;
  editingId = node.id;
  editingOriginalText = node.text;
  editingOriginalSize = { width: nodeWidth(node), height: nodeHeight(node) };
  render();
  requestAnimationFrame(() => {
    const input = elements.nodes.querySelector(`[data-node-id="${CSS.escape(node.id)}"] .node-inline-editor`);
    input?.focus();
    if (selectAll) input?.select();
  });
}

function finishInlineEdit(value, cancelled = false) {
  const id = editingId;
  if (!id || !board?.nodes[id]) return;
  const node = board.nodes[id];
  const nextText = cancelled ? editingOriginalText : cleanText(value, editingOriginalText);
  if (cancelled && editingOriginalSize) {
    node.width = editingOriginalSize.width;
    node.height = editingOriginalSize.height;
  }
  editingId = null;
  editingOriginalText = "";
  const sizeChanged = editingOriginalSize && (node.width !== editingOriginalSize.width || node.height !== editingOriginalSize.height);
  editingOriginalSize = null;
  if (node.text !== nextText || sizeChanged) {
    node.text = nextText;
    node.updatedAt = Date.now();
    touchBoard();
    saveNode(node);
  }
  render();
  elements.canvas.focus();
}

function deleteSelected() {
  if (!board || selectedId === "root" || !board.nodes[selectedId]) {
    if (selectedId === "root") showToast("중심 아이디어는 삭제할 수 없어요.");
    return;
  }
  const ids = [...descendants(board.nodes, selectedId)];
  for (const id of ids) delete board.nodes[id];
  selectedId = "root";
  touchBoard();
  render();
  removeNodes(ids);
  showToast(ids.length > 1 ? `${ids.length}개의 연결된 아이디어를 삭제했어요.` : "아이디어를 삭제했어요.");
}

function onCanvasPointerDown(event) {
  const nodeElement = event.target.closest(".mind-node");
  if (event.target.closest(".node-inline-editor")) return;
  if (nodeElement) {
    const id = nodeElement.dataset.nodeId;
    const node = board.nodes[id];
    selectedId = id;
    interaction = {
      type: "node",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      nodeX: node.x,
      nodeY: node.y,
      branchIds: [...descendants(board.nodes, id)],
      branchPositions: Object.fromEntries([...descendants(board.nodes, id)].map((branchId) => [branchId, { x: board.nodes[branchId].x, y: board.nodes[branchId].y }])),
      moved: false,
      dropTargetId: null
    };
    nodeElement.setPointerCapture?.(event.pointerId);
    // 클릭할 때 노드 DOM을 교체하면 브라우저의 더블클릭 판정이 끊긴다.
    // 선택 스타일만 갱신해 중심 노드를 포함한 모든 노드의 dblclick을 유지한다.
    updateNodeSelection();
  } else {
    elements.canvas.setPointerCapture?.(event.pointerId);
    interaction = {
      type: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y
    };
    elements.canvas.classList.add("panning");
  }
}

function onCanvasDoubleClick(event) {
  if (event.target.closest(".node-add, .node-collapse, .node-dot, .node-palette, .node-inline-editor")) return;
  const nodeElement = event.target.closest(".mind-node");
  if (!nodeElement) return;
  event.preventDefault();
  selectedId = nodeElement.dataset.nodeId;
  updateNodeSelection();
  startInlineEdit(true);
}

function onPointerMove(event) {
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  const dx = event.clientX - interaction.startX;
  const dy = event.clientY - interaction.startY;
  if (interaction.type === "pan") {
    transform.x = interaction.originX + dx;
    transform.y = interaction.originY + dy;
    applyTransform();
    return;
  }
  const node = board.nodes[selectedId];
  if (!node) return;
  if (!interaction.moved) {
    if (Math.hypot(dx, dy) <= 5) return;
    interaction.moved = true;
  }
  interaction.branchIds.forEach((id) => {
    board.nodes[id].x = interaction.branchPositions[id].x;
    board.nodes[id].y = interaction.branchPositions[id].y;
  });
  translateBranch(board.nodes, selectedId, dx / transform.scale, dy / transform.scale);
  const rect = elements.canvas.getBoundingClientRect();
  const worldX = (event.clientX - rect.left - transform.x) / transform.scale;
  const worldY = (event.clientY - rect.top - transform.y) / transform.scale;
  const visibleNodes = Object.fromEntries([...visibleNodeIds(board.nodes)].map((id) => [id, board.nodes[id]]));
  interaction.dropTargetId = dropTargetAt(visibleNodes, selectedId, worldX, worldY);
  updateBoardGeometry();
  updateDropTarget(interaction.dropTargetId);
}

function onPointerUp(event) {
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  if (interaction.type === "node" && interaction.moved) {
    const node = board.nodes[selectedId];
    if (event.type === "pointercancel") {
      interaction.branchIds.forEach((id) => {
        board.nodes[id].x = interaction.branchPositions[id].x;
        board.nodes[id].y = interaction.branchPositions[id].y;
      });
    } else {
      const target = board.nodes[interaction.dropTargetId];
      if (target) {
        const otherNodes = { ...board.nodes };
        delete otherNodes[node.id];
        const position = childPosition(otherNodes, target);
        translateBranch(board.nodes, selectedId, position.x - node.x, position.y - node.y);
        node.parentId = target.id;
        showToast(`‘${target.text}’의 하위 아이디어로 이동했어요.`);
      }
      const updatedAt = Date.now();
      const movedNodes = interaction.branchIds.map((id) => board.nodes[id]);
      movedNodes.forEach((movedNode) => {
        movedNode.x = Math.round(movedNode.x);
        movedNode.y = Math.round(movedNode.y);
        movedNode.updatedAt = updatedAt;
      });
      touchBoard();
      saveNodes(movedNodes);
    }
    render();
  }
  interaction = null;
  elements.canvas.classList.remove("panning");
  updateDropTarget();
}

function onWheel(event) {
  event.preventDefault();
  const rect = elements.canvas.getBoundingClientRect();
  const pointX = event.clientX - rect.left;
  const pointY = event.clientY - rect.top;
  const oldScale = transform.scale;
  const nextScale = clamp(oldScale * (event.deltaY < 0 ? 1.1 : 0.9), 0.28, 2.2);
  const worldX = (pointX - transform.x) / oldScale;
  const worldY = (pointY - transform.y) / oldScale;
  transform.scale = nextScale;
  transform.x = pointX - worldX * nextScale;
  transform.y = pointY - worldY * nextScale;
  applyTransform();
}

function zoomBy(amount) {
  const rect = elements.canvas.getBoundingClientRect();
  const fakeEvent = {
    preventDefault() {},
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    deltaY: amount > 1 ? -1 : 1
  };
  onWheel(fakeEvent);
}

function fitView(initial) {
  if (!board) return;
  const visibleIds = visibleNodeIds(board.nodes);
  const values = Object.values(board.nodes).filter((node) => visibleIds.has(node.id));
  const minX = Math.min(...values.map((node) => node.x));
  const minY = Math.min(...values.map((node) => node.y));
  const maxX = Math.max(...values.map((node) => node.x + nodeWidth(node)));
  const maxY = Math.max(...values.map((node) => node.y + nodeHeight(node)));
  const rect = elements.canvas.getBoundingClientRect();
  const padding = initial ? 220 : 140;
  const width = Math.max(maxX - minX, 460);
  const height = Math.max(maxY - minY, 240);
  transform.scale = clamp(Math.min((rect.width - padding) / width, (rect.height - padding) / height), 0.35, initial ? 1 : 1.25);
  transform.x = rect.width / 2 - (minX + width / 2) * transform.scale;
  transform.y = rect.height / 2 - (minY + height / 2) * transform.scale;
  applyTransform();
}

async function shareBoard() {
  try {
    await navigator.clipboard.writeText(location.href);
    showToast("공유 링크를 복사했어요.");
  } catch {
    prompt("아래 링크를 복사해 공유하세요.", location.href);
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2400);
}

function setConnection(mode, label) {
  elements.connectionStatus.className = `connection-status ${mode}`;
  elements.connectionLabel.textContent = label;
}

function renderPresence(users = {}) {
  const activeUsers = Object.values(users).filter((user) => Date.now() - Number(user.updatedAt || 0) < 90_000);
  elements.presenceDots.replaceChildren();
  activeUsers.slice(0, 4).forEach((user, index) => {
    const dot = document.createElement("i");
    dot.style.setProperty("--presence-color", user.color || "#6c5ce7");
    dot.style.zIndex = String(5 - index);
    elements.presenceDots.append(dot);
  });
  elements.presenceLabel.textContent = activeUsers.length <= 1 ? "나만 접속 중" : `${activeUsers.length}명 편집 중`;
}

async function connectFirebase() {
  const config = window.MIND_TOGETHER_FIREBASE_CONFIG;
  if (!config?.apiKey || !config?.databaseURL) {
    setConnection("local", "이 브라우저에 저장 중");
    return;
  }

  setConnection("syncing", "공동편집 연결 중");
  const [{ initializeApp }, authModule, databaseModule] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database.js`)
  ]);
  const app = initializeApp(config);
  const auth = authModule.getAuth(app);
  const credential = await authModule.signInAnonymously(auth);
  const database = databaseModule.getDatabase(app);
  const roomRef = databaseModule.ref(database, `rooms/${roomId}`);
  const roomSnapshot = await databaseModule.get(roomRef);

  if (!roomSnapshot.exists()) {
    await databaseModule.set(roomRef, board);
  } else {
    isApplyingRemote = true;
    board = normalizeBoard(roomSnapshot.val(), roomId);
    isApplyingRemote = false;
    persistLocal();
    rememberCurrentRoom();
    renderRoomLists();
    selectedId = board.nodes[selectedId] ? selectedId : "root";
    render();
    fitView(true);
  }

  const userId = credential.user.uid;
  const userName = localStorage.getItem("mind-together:name") || `참여자 ${Math.floor(Math.random() * 90 + 10)}`;
  localStorage.setItem("mind-together:name", userName);
  const presenceRef = databaseModule.ref(database, `rooms/${roomId}/presence/${userId}`);
  const presenceColors = ["#6c5ce7", "#2d9cdb", "#18a77c", "#f2994a", "#ef5da8"];
  const presenceData = { name: userName, color: presenceColors[userId.charCodeAt(0) % presenceColors.length], updatedAt: databaseModule.serverTimestamp() };
  await databaseModule.set(presenceRef, presenceData);
  await databaseModule.onDisconnect(presenceRef).remove();

  const unsubscribeRoom = databaseModule.onValue(roomRef, (snapshot) => {
    if (!snapshot.exists() || interaction?.type === "node" || editingId) return;
    isApplyingRemote = true;
    board = normalizeBoard(snapshot.val(), roomId);
    localStorage.setItem(storageKey, JSON.stringify(board));
    isApplyingRemote = false;
    rememberCurrentRoom();
    renderRoomLists();
    selectedId = board.nodes[selectedId] ? selectedId : "root";
    render();
  });
  const unsubscribePresence = databaseModule.onValue(databaseModule.ref(database, `rooms/${roomId}/presence`), (snapshot) => renderPresence(snapshot.val() || {}));
  const heartbeat = setInterval(() => databaseModule.update(presenceRef, { updatedAt: databaseModule.serverTimestamp() }), 45_000);

  remote = {
    async saveNode(node) {
      await databaseModule.update(databaseModule.ref(database, `rooms/${roomId}`), {
        [`nodes/${node.id}`]: node,
        updatedAt: databaseModule.serverTimestamp()
      });
    },
    async saveNodes(nodes) {
      const updates = { updatedAt: databaseModule.serverTimestamp() };
      nodes.forEach((node) => { updates[`nodes/${node.id}`] = node; });
      await databaseModule.update(databaseModule.ref(database, `rooms/${roomId}`), updates);
    },
    async saveTitle(title) {
      await databaseModule.update(roomRef, { title, updatedAt: databaseModule.serverTimestamp() });
    },
    async removeNodes(ids) {
      const updates = { updatedAt: databaseModule.serverTimestamp() };
      ids.forEach((id) => { updates[`nodes/${id}`] = null; });
      await databaseModule.update(roomRef, updates);
    },
    disconnect() {
      clearInterval(heartbeat);
      unsubscribeRoom();
      unsubscribePresence();
      databaseModule.remove(presenceRef).catch(() => {});
    }
  };
  setConnection("online", "모든 변경사항 저장됨");
}

function saveNode(node) {
  setConnection(remote ? "syncing" : "local", remote ? "저장 중" : "이 브라우저에 저장 중");
  remote?.saveNode(node).then(() => setConnection("online", "모든 변경사항 저장됨")).catch(handleRemoteError);
}

function saveNodes(nodes) {
  setConnection(remote ? "syncing" : "local", remote ? "저장 중" : "이 브라우저에 저장 중");
  remote?.saveNodes(nodes).then(() => setConnection("online", "모든 변경사항 저장됨")).catch(handleRemoteError);
}

function saveTitle() {
  remote?.saveTitle(board.title).then(() => setConnection("online", "모든 변경사항 저장됨")).catch(handleRemoteError);
}

function removeNodes(ids) {
  remote?.removeNodes(ids).then(() => setConnection("online", "모든 변경사항 저장됨")).catch(handleRemoteError);
}

function handleRemoteError(error) {
  console.error(error);
  setConnection("error", "동기화 지연 · 로컬 저장됨");
  showToast("인터넷 연결 후 다시 동기화할게요.");
}
