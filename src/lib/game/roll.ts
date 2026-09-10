import type { RollFace } from "./types";

// The digital baseline follows the 2024 SNU/KAIST paper assumption:
// each virtual stick shows its flat side with probability 0.6.
// Stick 0 is the marked stick used to distinguish BACKDO from DO.
export const FLAT_SIDE_PROBABILITY = 0.6;

export function castYut(random = Math.random): RollFace {
  const flat = Array.from({ length: 4 }, () => random() < FLAT_SIDE_PROBABILITY);
  const flatCount = flat.filter(Boolean).length;

  if (flatCount === 0) return "MO";
  if (flatCount === 4) return "YUT";
  if (flatCount === 3) return "GEOL";
  if (flatCount === 2) return "GAE";
  return flat[0] ? "BACKDO" : "DO";
}

export function baseStepsForFace(face: RollFace) {
  switch (face) {
    case "BACKDO": return -1;
    case "DO": return 1;
    case "GAE": return 2;
    case "GEOL": return 3;
    case "YUT": return 4;
    case "MO": return 5;
    case "MOVE1": return 1;
  }
}

export function faceLabel(face: RollFace) {
  switch (face) {
    case "BACKDO": return "백도";
    case "DO": return "도";
    case "GAE": return "개";
    case "GEOL": return "걸";
    case "YUT": return "윷";
    case "MO": return "모";
    case "MOVE1": return "1칸 이동권";
  }
}
