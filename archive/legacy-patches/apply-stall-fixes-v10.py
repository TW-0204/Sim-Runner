from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one occurrence in {path}, got {count}: {old[:220]!r}")
    write(path, text.replace(old, new, 1))


# ---------------------------------------------------------------------------
# A16: when the first shortened finish is 22, routes coming from the 10-side
# diagonal may reach center 15 and then follow the old 15 -> 23 branch.
# Reroute only that now-removed suffix through the surviving 15 -> 16 -> 17 -> 22
# branch while preserving the number of movement steps already rolled.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/game/engine.ts",
    '''function applyMarginShrinkToForwardMove(
  movement: ReturnType<typeof forwardMoveOptions>[number],
  shrink: ReturnType<typeof marginShrinkState>,
) {
  if (!shrink) return movement;
  const finishIndex = movement.traversed.indexOf(shrink.finishNode);
  if (finishIndex >= 0) {
    return { ...movement, finished: true, node: null, traversed: movement.traversed.slice(0, finishIndex + 1) };
  }
  if (movement.traversed.some((node) => !shrink.allowed.has(node))) return null;
  return movement;
}
''',
    '''function applyMarginShrinkToForwardMove(
  movement: ReturnType<typeof forwardMoveOptions>[number],
  shrink: ReturnType<typeof marginShrinkState>,
) {
  if (!shrink) return movement;

  if (shrink.finishNode === 22) {
    const centerIndex = movement.traversed.indexOf(15);
    const removedSuffix = centerIndex >= 0 ? movement.traversed.slice(centerIndex + 1) : [];
    if (centerIndex >= 0 && removedSuffix.some((node) => !shrink.allowed.has(node))) {
      const survivingSuffix = [16, 17, 22].slice(0, removedSuffix.length);
      const rerouted = [
        ...movement.traversed.slice(0, centerIndex + 1),
        ...survivingSuffix,
      ];
      const reroutedFinishIndex = rerouted.indexOf(22);
      if (reroutedFinishIndex >= 0) {
        return {
          ...movement,
          finished: true,
          node: null,
          traversed: rerouted.slice(0, reroutedFinishIndex + 1),
        };
      }
      return {
        ...movement,
        finished: false,
        node: rerouted[rerouted.length - 1] ?? 15,
        traversed: rerouted,
      };
    }
  }

  const finishIndex = movement.traversed.indexOf(shrink.finishNode);
  if (finishIndex >= 0) {
    return { ...movement, finished: true, node: null, traversed: movement.traversed.slice(0, finishIndex + 1) };
  }
  if (movement.traversed.some((node) => !shrink.allowed.has(node))) return null;
  return movement;
}
''',
)


# ---------------------------------------------------------------------------
# A08: Great Upheaval can assign FINISHED directly, bypassing the normal move
# lifecycle. For special-win augments that replace normal victory, immediately
# normalize those generated FINISHED states through specialWinForPlayer.
# P14 keeps its dedicated lap resolver added in v7.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/game/engine.ts",
    '''  const orderedPlayers = [...engine.players].sort((left, right) => {
    if (left.userId === sourceUserId) return -1;
    if (right.userId === sourceUserId) return 1;
    return left.seat - right.seat;
  });
  for (const player of orderedPlayers) {
''',
    '''  const orderedPlayers = [...engine.players].sort((left, right) => {
    if (left.userId === sourceUserId) return -1;
    if (right.userId === sourceUserId) return 1;
    return left.seat - right.seat;
  });

  for (const player of orderedPlayers) {
    const owned = ownedByUser[player.userId] ?? [];
    if (
      isForcedRelocationImmune(owned)
      || owned.includes("P14")
      || !replacesNormalWinCondition(owned)
    ) continue;
    const special = specialWinForPlayer(engine, player.userId, owned);
    if (!special) continue;
    declareWinner(engine, player.userId, special.condition, special.message);
    return engine;
  }

  for (const player of orderedPlayers) {
''',
)

print("Applied stall fixes v10: A16 center-crossing reroute and A08 special-win normalization.")
