import test from "node:test";
import assert from "node:assert/strict";
import {
  createBoard,
  createNode,
  childPosition,
  rootPosition,
  cleanText,
  canReparent,
  descendants,
  visibleNodeIds,
  translateBranch,
  dropTargetAt,
  edgeAnchors,
  edgePath,
  estimatedNodeSize,
  normalizeBoard
} from "../src/model.js";

test("새 보드에는 중심 아이디어가 생성된다", () => {
  const board = createBoard("room-12345678901234567890", 100);
  assert.equal(board.title, "새 마인드맵");
  assert.equal(board.nodes.root.id, "root");
  assert.equal(board.nodes.root.createdAt, 100);
});

test("사용자 입력은 공백을 정규화하고 길이를 제한한다", () => {
  assert.equal(cleanText("  회원   증가  "), "회원 증가");
  assert.equal(cleanText("", "기본값"), "기본값");
  assert.equal(cleanText("가".repeat(130)).length, 120);
});

test("하위 노드는 부모와 겹치지 않는 위치에 배치된다", () => {
  const parent = createNode({ id: "root", x: 1000, y: 1000 });
  const position = childPosition({ root: parent }, parent);
  assert.notEqual(position.x, parent.x);
  assert.notEqual(position.y, parent.y);
});

test("가지 삭제 범위에 모든 자손이 포함된다", () => {
  const nodes = {
    root: createNode({ id: "root" }),
    a: createNode({ id: "a", parentId: "root" }),
    b: createNode({ id: "b", parentId: "a" }),
    c: createNode({ id: "c", parentId: "root" })
  };
  assert.deepEqual([...descendants(nodes, "a")].sort(), ["a", "b"]);
});

test("접힌 노드의 자손만 숨기고 다른 중심 아이디어는 계속 표시한다", () => {
  const nodes = {
    root: createNode({ id: "root", collapsed: true }),
    a: createNode({ id: "a", parentId: "root" }),
    b: createNode({ id: "b", parentId: "a" }),
    secondRoot: createNode({ id: "secondRoot", x: 2500 }),
    c: createNode({ id: "c", parentId: "secondRoot" })
  };
  assert.deepEqual([...visibleNodeIds(nodes)].sort(), ["c", "root", "secondRoot"]);
});

test("부모 가지를 이동하면 모든 자손이 같은 거리만큼 이동한다", () => {
  const nodes = {
    root: createNode({ id: "root", x: 1000, y: 1000 }),
    a: createNode({ id: "a", parentId: "root", x: 1300, y: 900 }),
    b: createNode({ id: "b", parentId: "a", x: 1550, y: 850 }),
    other: createNode({ id: "other", x: 200, y: 200 })
  };
  const moved = translateBranch(nodes, "a", 120, 80);
  assert.deepEqual(moved.ids.sort(), ["a", "b"]);
  assert.deepEqual([nodes.a.x, nodes.a.y], [1420, 980]);
  assert.deepEqual([nodes.b.x, nodes.b.y], [1670, 930]);
  assert.deepEqual([nodes.other.x, nodes.other.y], [200, 200]);
});

test("추가 중심 아이디어는 별도 루트 위치에 생성되고 다른 노드 아래로 붙지 않는다", () => {
  const root = createNode({ id: "root", x: 1905, y: 1467 });
  const nodes = { root };
  const position = rootPosition(nodes);
  const secondRoot = createNode({ id: "secondRoot", ...position });
  nodes.secondRoot = secondRoot;
  assert.notDeepEqual(position, { x: root.x, y: root.y });
  assert.equal(canReparent(nodes, "secondRoot", "root"), false);
});

test("노드는 다른 가지로 이동할 수 있지만 자신의 자손 아래로는 이동할 수 없다", () => {
  const nodes = {
    root: createNode({ id: "root", x: 0, y: 0 }),
    a: createNode({ id: "a", parentId: "root", x: 300, y: 0 }),
    b: createNode({ id: "b", parentId: "a", x: 600, y: 0 }),
    c: createNode({ id: "c", parentId: "root", x: 300, y: 200 })
  };
  assert.equal(canReparent(nodes, "a", "c"), true);
  assert.equal(canReparent(nodes, "a", "b"), false);
  assert.equal(canReparent(nodes, "root", "a"), false);
});

test("드래그 좌표 아래의 유효한 부모 노드를 찾는다", () => {
  const nodes = {
    root: createNode({ id: "root", x: 0, y: 0 }),
    a: createNode({ id: "a", parentId: "root", x: 300, y: 0 }),
    b: createNode({ id: "b", parentId: "root", x: 600, y: 0 })
  };
  assert.equal(dropTargetAt(nodes, "a", 650, 30), "b");
  assert.equal(dropTargetAt(nodes, "a", 350, 30), null);
  assert.equal(dropTargetAt(nodes, "root", 650, 30), null);
});

test("손상된 보드 데이터는 안전한 기본값으로 정규화된다", () => {
  const board = normalizeBoard({ title: "", nodes: { x: { text: "", x: -3, y: 99999, color: "red" } } }, "room-test");
  assert.ok(board.nodes.root);
  assert.equal(board.nodes.x.text, "새 아이디어");
  assert.equal(board.nodes.x.color, "violet");
  assert.equal(board.nodes.x.x, 0);
});

test("연결선은 SVG cubic path로 생성된다", () => {
  const parent = createNode({ x: 100, y: 100 });
  const child = createNode({ x: 500, y: 200 });
  assert.match(edgePath(parent, child), /^M .+ C .+$/);
});

test("연결선은 상대 위치에 따라 노드의 좌우 또는 상하 면에 붙는다", () => {
  const center = createNode({ id: "center", x: 500, y: 500 });
  const right = createNode({ id: "right", x: 900, y: 500 });
  const above = createNode({ id: "above", x: 500, y: 100 });
  const rightAnchors = edgeAnchors(center, right);
  const aboveAnchors = edgeAnchors(center, above);
  assert.equal(rightAnchors.start.x, center.x + center.width);
  assert.equal(rightAnchors.start.nx, 1);
  assert.equal(aboveAnchors.start.y, center.y);
  assert.equal(aboveAnchors.start.ny, -1);
});

test("긴 텍스트는 노드의 너비 또는 높이를 확장한다", () => {
  const short = estimatedNodeSize("짧은 생각");
  const long = estimatedNodeSize("매우 긴 아이디어를 입력할 때에도 텍스트 전체를 편안하게 확인할 수 있어야 합니다".repeat(2));
  assert.ok(long.width > short.width || long.height > short.height);
});
