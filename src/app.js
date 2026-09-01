import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  NODE_WIDTH,
  NODE_HEIGHT,
  createId,
  createNode,
  createBoard,
  childPosition,
  cleanText,
  descendants,
  edgePath,
  normalizeBoard,
  clamp
} from "./model.js";

const FIREBASE_VERSION = "12.18.0";
const roomMatch = location.hash.match(/^#\/room\/([a-zA-Z0-9_-]{20,80})$/);
const roomId = roomMatch?.[1] ?? null;
const storageKey = roomId ? `mind-together:${roomId}` : null;

const elements = {
  welcome: document.querySelector("#welcome"),
  createBoard: document.querySelector("#create-board"),
  boardTitle: document.querySelector("#board-title"),
  canvas: document.querySelector("#canvas"),
  viewport: document.querySelector("#viewport"),
  nodes: document.querySelector("#nodes"),
  edges: document.querySelector("#edges"),
  addNode: document.querySelector("#add-node"),
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
let transform = { x: 0, y: 0, scale: 1 };
let interaction = null;
let remote = null;
let isApplyingRemote = false;
let toastTimer = null;

if (roomId) {
  elements.welcome.classList.add("hidden");
  render();
  requestAnimationFrame(() => fitView(true));
  connectFirebase().catch((error) => {
    console.warn("Firebase 연결 실패, 로컬 모드로 전환합니다.", error);
    setConnection("local", "이 브라우저에 저장 중");
  });
}

elements.createBoard.addEventListener("click", () => {
  const newRoomId = createId("room");
  location.hash = `/room/${newRoomId}`;
  location.reload();
});

elements.addNode.addEventListener("click", addChildNode);
elements.editNode.addEventListener("click", () => startInlineEdit());
elements.deleteNode.addEventListener("click", deleteSelected);
elements.zoomIn.addEventListener("click", () => zoomBy(1.16));
elements.zoomOut.addEventListener("click", () => zoomBy(0.86));
elements.fitView.addEventListener("click", () => fitView(false));
elements.shareButton.addEventListener("click", shareBoard);

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
  localStorage.setItem(storageKey, JSON.stringify(board));
}

function touchBoard() {
  board.updatedAt = Date.now();
  persistLocal();
}

function render() {
  if (!board) return;
  elements.boardTitle.value = board.title;
  elements.nodes.replaceChildren();
  elements.edges.replaceChildren();

  for (const node of Object.values(board.nodes)) {
    if (node.parentId && board.nodes[node.parentId]) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", edgePath(board.nodes[node.parentId], node));
      path.setAttribute("class", `edge edge-${node.color}`);
      elements.edges.append(path);
    }
  }

  for (const node of Object.values(board.nodes)) {
    const nodeElement = document.createElement("div");
    nodeElement.tabIndex = 0;
    nodeElement.setAttribute("role", "button");
    nodeElement.className = `mind-node color-${node.color}${selectedId === node.id ? " selected" : ""}${node.id === "root" ? " root-node" : ""}${editingId === node.id ? " editing" : ""}`;
    nodeElement.dataset.nodeId = node.id;
    nodeElement.style.transform = `translate(${node.x}px, ${node.y}px)`;
    nodeElement.innerHTML = `<span class="node-dot"></span><span class="node-copy"></span><span class="node-add" aria-hidden="true">＋</span>`;
    const copyElement = nodeElement.querySelector(".node-copy");
    if (editingId === node.id) {
      const input = document.createElement("input");
      input.className = "node-inline-editor";
      input.type = "text";
      input.maxLength = 120;
      input.value = node.text;
      input.setAttribute("aria-label", `${node.text} 수정`);
      input.addEventListener("pointerdown", (event) => event.stopPropagation());
      input.addEventListener("click", (event) => event.stopPropagation());
      input.addEventListener("dblclick", (event) => event.stopPropagation());
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
    } else {
      copyElement.textContent = node.text;
    }
    nodeElement.setAttribute("aria-label", `${node.text} 아이디어`);
    nodeElement.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      selectedId = node.id;
      startInlineEdit(true);
    });
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

function addChildNode() {
  if (!board) return;
  const parent = board.nodes[selectedId] ?? board.nodes.root;
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
  saveNode(node);
  startInlineEdit(true);
}

function startInlineEdit(selectAll = false) {
  const node = board?.nodes[selectedId];
  if (!node || editingId) return;
  editingId = node.id;
  editingOriginalText = node.text;
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
  editingId = null;
  editingOriginalText = "";
  if (node.text !== nextText) {
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
  elements.canvas.setPointerCapture?.(event.pointerId);
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
      moved: false
    };
    // 클릭할 때 노드 DOM을 교체하면 브라우저의 더블클릭 판정이 끊긴다.
    // 선택 스타일만 갱신해 중심 노드를 포함한 모든 노드의 dblclick을 유지한다.
    updateNodeSelection();
  } else {
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
  node.x = clamp(interaction.nodeX + dx / transform.scale, 0, BOARD_WIDTH - NODE_WIDTH);
  node.y = clamp(interaction.nodeY + dy / transform.scale, 0, BOARD_HEIGHT - NODE_HEIGHT);
  interaction.moved ||= Math.abs(dx) + Math.abs(dy) > 4;
  render();
}

function onPointerUp(event) {
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  if (interaction.type === "node" && interaction.moved) {
    const node = board.nodes[selectedId];
    node.x = Math.round(node.x);
    node.y = Math.round(node.y);
    node.updatedAt = Date.now();
    touchBoard();
    saveNode(node);
  }
  interaction = null;
  elements.canvas.classList.remove("panning");
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
  const values = Object.values(board.nodes);
  const minX = Math.min(...values.map((node) => node.x));
  const minY = Math.min(...values.map((node) => node.y));
  const maxX = Math.max(...values.map((node) => node.x + NODE_WIDTH));
  const maxY = Math.max(...values.map((node) => node.y + NODE_HEIGHT));
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
    persistLocal();
    isApplyingRemote = false;
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
