import test from "node:test";
import assert from "node:assert/strict";
import {
  createBoard,
  createNode,
  childPosition,
  cleanText,
  descendants,
  edgePath,
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
