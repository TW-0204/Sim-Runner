import type { PieceState, RollToken } from "./types";

export const FINISH_NODE = 30;
export const START_NODE = 0;

export const BOARD_POSITIONS: Record<number, { x: number; y: number }> = {
  1: { x: 90, y: 74 },
  2: { x: 90, y: 58 },
  3: { x: 90, y: 42 },
  4: { x: 90, y: 26 },
  5: { x: 90, y: 10 },
  6: { x: 74, y: 10 },
  7: { x: 58, y: 10 },
  8: { x: 42, y: 10 },
  9: { x: 26, y: 10 },
  10: { x: 10, y: 10 },
  11: { x: 26, y: 26 },
  12: { x: 42, y: 42 },
  13: { x: 74, y: 26 },
  14: { x: 58, y: 42 },
  15: { x: 50, y: 50 },
  16: { x: 42, y: 58 },
  17: { x: 26, y: 74 },
  18: { x: 10, y: 26 },
  19: { x: 10, y: 42 },
  20: { x: 10, y: 58 },
  21: { x: 10, y: 74 },
  22: { x: 10, y: 90 },
  23: { x: 58, y: 58 },
  24: { x: 74, y: 74 },
  25: { x: 26, y: 90 },
  26: { x: 42, y: 90 },
  27: { x: 58, y: 90 },
  28: { x: 74, y: 90 },
  29: { x: 90, y: 90 },
};

export const BOARD_LINES: Array<[number, number]> = [
  [1, 2], [2, 3], [3, 4], [4, 5],
  [5, 6], [6, 7], [7, 8], [8, 9], [9, 10],
  [10, 18], [18, 19], [19, 20], [20, 21], [21, 22],
  [22, 25], [25, 26], [26, 27], [27, 28], [28, 29],
  [5, 13], [13, 14], [14, 15], [15, 16], [16, 17], [17, 22],
  [10, 11], [11, 12], [12, 15], [15, 23], [23, 24], [24, 29],
];

const OUTER_ROUTE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 18, 19, 20, 21, 22, 25, 26, 27, 28, 29, 30];
const FROM_5 = [5, 13, 14, 15, 16, 17, 22, 25, 26, 27, 28, 29, 30];
const FROM_10 = [10, 11, 12, 15, 23, 24, 29, 30];
const FROM_15 = [15, 23, 24, 29, 30];
const FROM_15_LEFT = [15, 16, 17, 22, 25, 26, 27, 28, 29, 30];
const FROM_13 = [13, 14, 15, 16, 17, 22, 25, 26, 27, 28, 29, 30];
const FROM_14 = [14, 15, 16, 17, 22, 25, 26, 27, 28, 29, 30];
const FROM_11 = [11, 12, 15, 23, 24, 29, 30];
const FROM_12 = [12, 15, 23, 24, 29, 30];
const FROM_16 = [16, 17, 22, 25, 26, 27, 28, 29, 30];
const FROM_17 = [17, 22, 25, 26, 27, 28, 29, 30];
const FROM_23 = [23, 24, 29, 30];
const FROM_24 = [24, 29, 30];

// P04 우주의 중심용 경로. 아래 두 경로는 현재 진행 방향과 반대쪽 대각선을 타고
// 중앙을 지난 뒤 반대 모퉁이에서 기존 외곽 진행 방향으로 합류한다.
const FROM_22_CENTER = [22, 17, 16, 15, 14, 13, 5, 6, 7, 8, 9, 10, 18, 19, 20, 21, 22, 25, 26, 27, 28, 29, 30];
const FROM_29_CENTER = [29, 24, 23, 15, 12, 11, 10, 18, 19, 20, 21, 22, 25, 26, 27, 28, 29, 30];

export type ForwardMoveOptions = {
  forbidShortcutEntry?: boolean;
  allowPassingShortcutEntry?: boolean;
  allowUniversalCenterChoice?: boolean;
};

function routeForStart(node: number, options: ForwardMoveOptions = {}) {
  if (options.forbidShortcutEntry && (node === 5 || node === 10)) return OUTER_ROUTE;
  if (node === 5) return FROM_5;
  if (node === 10) return FROM_10;
  if (node === 15) return FROM_15;
  if (node === 13) return FROM_13;
  if (node === 14) return FROM_14;
  if (node === 11) return FROM_11;
  if (node === 12) return FROM_12;
  if (node === 16) return FROM_16;
  if (node === 17) return FROM_17;
  if (node === 23) return FROM_23;
  if (node === 24) return FROM_24;
  return OUTER_ROUTE;
}

function initialRoutesForStart(node: number, options: ForwardMoveOptions = {}) {
  if (options.allowUniversalCenterChoice && !options.forbidShortcutEntry) {
    if (node === 5) return [OUTER_ROUTE, FROM_5];
    if (node === 10) return [OUTER_ROUTE, FROM_10];
    if (node === 22) return [OUTER_ROUTE, FROM_22_CENTER];
    if (node === 29) return [OUTER_ROUTE, FROM_29_CENTER];
  }
  return [routeForStart(node, options)];
}

export type ForwardMove = {
  finished: boolean;
  node: number | null;
  traversed: number[];
  usedPassingShortcut?: boolean;
};

type RouteState = {
  route: number[];
  index: number;
  traversed: number[];
  usedPassingShortcut: boolean;
};

function passingRouteChoices(state: RouteState, step: number, options: ForwardMoveOptions) {
  if (!options.allowPassingShortcutEntry || options.forbidShortcutEntry || step <= 1) {
    return [{ route: state.route, usedPassingShortcut: state.usedPassingShortcut }];
  }

  const current = state.route[state.index];
  const routes = [state.route];
  if (current === 5) routes.push(FROM_5);
  else if (current === 10) routes.push(FROM_10);
  else if (current === 15) routes.push(FROM_15_LEFT, FROM_15);

  const defaultNext = state.route[state.index + 1];
  const unique = new Map<string, { route: number[]; usedPassingShortcut: boolean }>();
  for (const route of routes) {
    const routeIndex = route === state.route ? state.index : route.indexOf(current);
    if (routeIndex < 0) continue;
    const next = route[routeIndex + 1];
    const usedPassingShortcut = state.usedPassingShortcut || next !== defaultNext;
    unique.set(`${route.join(",")}|${usedPassingShortcut}`, { route, usedPassingShortcut });
  }
  return [...unique.values()];
}

export function forwardMoveOptions(startNode: number, steps: number, options: ForwardMoveOptions = {}): ForwardMove[] {
  if (steps <= 0) return [];
  const initialStates: RouteState[] = initialRoutesForStart(startNode, options).flatMap((route) => {
    const startIndex = route.indexOf(startNode);
    return startIndex < 0 ? [] : [{ route, index: startIndex, traversed: [], usedPassingShortcut: false }];
  });
  if (!initialStates.length) return [];

  let states: RouteState[] = initialStates;
  const finished: ForwardMove[] = [];

  for (let step = 1; step <= steps; step += 1) {
    const nextStates: RouteState[] = [];
    for (const state of states) {
      for (const choice of passingRouteChoices(state, step, options)) {
        const current = state.route[state.index];
        const routeIndex = choice.route === state.route ? state.index : choice.route.indexOf(current);
        if (routeIndex < 0) continue;
        const next = choice.route[routeIndex + 1];
        if (next == null || next === FINISH_NODE) {
          finished.push({
            finished: true,
            node: null,
            traversed: state.traversed,
            usedPassingShortcut: choice.usedPassingShortcut,
          });
          continue;
        }
        nextStates.push({
          route: choice.route,
          index: routeIndex + 1,
          traversed: [...state.traversed, next],
          usedPassingShortcut: choice.usedPassingShortcut,
        });
      }
    }
    states = nextStates;
    if (!states.length) break;
  }

  const results: ForwardMove[] = [
    ...finished,
    ...states.map((state) => ({
      finished: false,
      node: state.route[state.index] ?? null,
      traversed: state.traversed,
      usedPassingShortcut: state.usedPassingShortcut,
    })),
  ];

  const deduped = new Map<string, ForwardMove>();
  for (const result of results) {
    const key = `${result.finished ? "F" : result.node}|${result.traversed.join(",")}`;
    const existing = deduped.get(key);
    if (!existing || (!existing.usedPassingShortcut && result.usedPassingShortcut)) deduped.set(key, result);
  }
  return [...deduped.values()];
}

export function moveForward(startNode: number, steps: number, options: ForwardMoveOptions = {}): ForwardMove | null {
  const moves = forwardMoveOptions(startNode, steps, { ...options, allowPassingShortcutEntry: false });
  return moves[0] ?? null;
}

const REVERSE_OUTER = [30, 29, 28, 27, 26, 25, 22, 21, 20, 19, 18, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
const REVERSE_FROM_29 = [29, 24, 23, 15, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
const REVERSE_FROM_22 = [22, 17, 16, 15, 14, 13, 5, 4, 3, 2, 1, 0];
const REVERSE_FROM_15 = [15, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
const REVERSE_FROM_15_LEFT = [15, 14, 13, 5, 4, 3, 2, 1, 0];
const REVERSE_FROM_24 = [24, 23, 15, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
const REVERSE_FROM_23 = [23, 15, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
const REVERSE_FROM_17 = [17, 16, 15, 14, 13, 5, 4, 3, 2, 1, 0];
const REVERSE_FROM_16 = [16, 15, 14, 13, 5, 4, 3, 2, 1, 0];
const REVERSE_FROM_14 = [14, 13, 5, 4, 3, 2, 1, 0];
const REVERSE_FROM_13 = [13, 5, 4, 3, 2, 1, 0];
const REVERSE_FROM_12 = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
const REVERSE_FROM_11 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

function reverseRouteForStart(node: number, options: ForwardMoveOptions = {}) {
  if (options.forbidShortcutEntry && (node === 29 || node === 22)) return REVERSE_OUTER;
  if (node === 29) return REVERSE_FROM_29;
  if (node === 22) return REVERSE_FROM_22;
  if (node === 15) return REVERSE_FROM_15_LEFT;
  if (node === 24) return REVERSE_FROM_24;
  if (node === 23) return REVERSE_FROM_23;
  if (node === 17) return REVERSE_FROM_17;
  if (node === 16) return REVERSE_FROM_16;
  if (node === 14) return REVERSE_FROM_14;
  if (node === 13) return REVERSE_FROM_13;
  if (node === 12) return REVERSE_FROM_12;
  if (node === 11) return REVERSE_FROM_11;
  return REVERSE_OUTER;
}

export type ReverseMove = {
  home: boolean;
  node: number | null;
  traversed: number[];
  usedPassingShortcut?: boolean;
};

function reversePassingRouteChoices(state: RouteState, step: number, options: ForwardMoveOptions) {
  if (!options.allowPassingShortcutEntry || options.forbidShortcutEntry || step <= 1) {
    return [{ route: state.route, usedPassingShortcut: state.usedPassingShortcut }];
  }
  const current = state.route[state.index];
  const routes = [state.route];
  if (current === 29) routes.push(REVERSE_FROM_29);
  else if (current === 22) routes.push(REVERSE_FROM_22);
  else if (current === 15) routes.push(REVERSE_FROM_15, REVERSE_FROM_15_LEFT);

  const defaultNext = state.route[state.index + 1];
  const unique = new Map<string, { route: number[]; usedPassingShortcut: boolean }>();
  for (const route of routes) {
    const routeIndex = route === state.route ? state.index : route.indexOf(current);
    if (routeIndex < 0) continue;
    const next = route[routeIndex + 1];
    const usedPassingShortcut = state.usedPassingShortcut || next !== defaultNext;
    unique.set(`${route.join(",")}|${usedPassingShortcut}`, { route, usedPassingShortcut });
  }
  return [...unique.values()];
}

export function reverseMoveOptions(startNode: number, steps: number, options: ForwardMoveOptions = {}): ReverseMove[] {
  if (steps <= 0) return [];
  const initialRoute = reverseRouteForStart(startNode, options);
  const startIndex = initialRoute.indexOf(startNode);
  if (startIndex < 0) return [];

  let states: RouteState[] = [{ route: initialRoute, index: startIndex, traversed: [], usedPassingShortcut: false }];
  const home: ReverseMove[] = [];

  for (let step = 1; step <= steps; step += 1) {
    const nextStates: RouteState[] = [];
    for (const state of states) {
      for (const choice of reversePassingRouteChoices(state, step, options)) {
        const current = state.route[state.index];
        const routeIndex = choice.route === state.route ? state.index : choice.route.indexOf(current);
        if (routeIndex < 0) continue;
        const next = choice.route[routeIndex + 1];
        if (next == null || next === START_NODE) {
          home.push({
            home: true,
            node: null,
            traversed: state.traversed,
            usedPassingShortcut: choice.usedPassingShortcut,
          });
          continue;
        }
        nextStates.push({
          route: choice.route,
          index: routeIndex + 1,
          traversed: [...state.traversed, next],
          usedPassingShortcut: choice.usedPassingShortcut,
        });
      }
    }
    states = nextStates;
    if (!states.length) break;
  }

  const results: ReverseMove[] = [
    ...home,
    ...states.map((state) => ({
      home: false,
      node: state.route[state.index] ?? null,
      traversed: state.traversed,
      usedPassingShortcut: state.usedPassingShortcut,
    })),
  ];
  const deduped = new Map<string, ReverseMove>();
  for (const result of results) {
    const key = `${result.home ? "H" : result.node}|${result.traversed.join(",")}`;
    const existing = deduped.get(key);
    if (!existing || (!existing.usedPassingShortcut && result.usedPassingShortcut)) deduped.set(key, result);
  }
  return [...deduped.values()];
}

export function moveReverse(startNode: number, steps: number, options: ForwardMoveOptions = {}) {
  return reverseMoveOptions(startNode, steps, { ...options, allowPassingShortcutEntry: false })[0] ?? null;
}

const BACKWARD_DEFAULT: Record<number, number> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 7,
  9: 8,
  10: 9,
  11: 10,
  12: 11,
  13: 5,
  14: 13,
  16: 15,
  17: 16,
  18: 10,
  19: 18,
  20: 19,
  21: 20,
  23: 15,
  24: 23,
  25: 22,
  26: 25,
  27: 26,
  28: 27,
};

export function backwardTargets(node: number): number[] {
  if (node === 1) return [29];
  if (node === 15) return [12, 14];
  if (node === 22) return [17, 21];
  if (node === 29) return [24, 28];
  const target = BACKWARD_DEFAULT[node];
  return target == null ? [] : [target];
}

export function backwardPaths(node: number, steps: number): number[][] {
  if (steps <= 0) return [];

  let paths: number[][] = [[]];
  let currentNodes = [node];

  for (let step = 0; step < steps; step += 1) {
    const nextPaths: number[][] = [];
    const nextNodes: number[] = [];

    for (let index = 0; index < currentNodes.length; index += 1) {
      const current = currentNodes[index];
      const prefix = paths[index];
      for (const target of backwardTargets(current)) {
        nextPaths.push([...prefix, target]);
        nextNodes.push(target);
      }
    }

    paths = nextPaths;
    currentNodes = nextNodes;
    if (!paths.length) break;
  }

  return paths;
}

export function backwardPathToTarget(node: number, steps: number, target: number) {
  return backwardPaths(node, steps).find((path) => path[path.length - 1] === target) ?? null;
}

export function legalTargets(piece: PieceState, result: RollToken): Array<{ node: number | null; finished: boolean }> {
  if (piece.status === "FINISHED") return [];

  if (result.face === "BACKDO") {
    if (piece.status !== "ON_BOARD" || piece.node == null) return [];
    const steps = Math.max(1, Math.abs(result.finalSteps));
    const endpoints = [...new Set(backwardPaths(piece.node, steps).map((path) => path[path.length - 1]).filter(Boolean))];
    return endpoints.map((node) => ({ node, finished: false }));
  }

  const startNode = piece.status === "WAITING" ? START_NODE : piece.node;
  if (startNode == null) return [];
  const move = moveForward(startNode, result.finalSteps, { forbidShortcutEntry: result.forbidShortcuts });
  if (!move) return [];
  return [{ node: move.node, finished: move.finished }];
}
