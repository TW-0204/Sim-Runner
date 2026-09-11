# Augment Visual Manifest

Updated: 2026-09-11  
Project: Augment Yut  
Branch baseline: `experiment/s16`

## Purpose

This is the single machine-readable human-facing snapshot for agents that create augment icons, card art, HUD assets, or visual prompts.

**Use this file before reading `src/lib/augments/catalog.ts`.** The repository uses a patch stack, so the raw catalog contains stale pre-patch values. The effective rules are the state after `bash scripts/apply-v3-stack.sh`.

## Maintenance contract

Whenever an augment changes, update this file in the **same commit**.

This includes:
- add/remove/reactivate an augment
- ID or name
- tier
- first/second/either acquisition timing
- natural-pool availability
- conflicts
- player-visible effect
- numeric tuning that changes the effect
- visual meaning

Pure refactors, logging-only changes, diagnostics, and simulation-only instrumentation do not require a manifest edit if player-visible behavior is unchanged.

## Current roster rules

- Catalog snapshot: 59 augments.
- `AUG-032 사방신` remains defined but is excluded from natural acquisition.
- Game format: 2 augments total.
- First augment: game start.
- Second augment: after Round 4.
- `first` means first augment only.
- `second` means second augment only.
- `either` means either slot.
- `AUG-044` is technically `not-last`; with the current 2-augment format this means first augment only.
- Do not generate visuals for removed/inactive IDs listed at the end.

## Visual reading rule

Visualize the **mechanic**, not the Korean name literally. Avoid generic crowns, trophies, fantasy emblems, lore scenes, or character illustrations unless the mechanic itself requires them. Do not put effect text or numbers inside the generated image.

| ID | Name | Tier | Slot | Effect snapshot | Visual cue |
| --- | --- | --- | --- | --- | --- |
| AUG-001 | 사냥꾼 1 | Silver | either | Capturing an opponent makes the capture-granted extra throw move +1 farther. | capture impact + bonus throw + short speed boost |
| AUG-002 | 어부바 | Silver | either | Every 4 successful new stack events grants 1 extra throw. | allied pieces stacking + accumulated charge + bonus throw |
| AUG-003 | 도찐개찐 | Silver | either | DO and BACKDO move 2 cells instead of their normal 1-cell distance. | DO and BACKDO glyphs with extended opposite-direction arrows |
| AUG-004 | 돌파 | Gold | either | After being captured 5 times total, the next 2 capture attempts against the player are nullified. | repeated capture marks completing a temporary guard |
| AUG-005 | 안전벨트 | Gold | either | If a stack of 2+ pieces is captured, the opponent does not gain the capture extra throw. | stacked pieces protected from the bonus-throw symbol |
| AUG-006 | 출발이 반 | Silver | either | A piece departing from WAITING gets +2 forward movement. | start gate + piece launching with strong forward trail |
| AUG-007 | 분풀이 | Silver | either | After one of your pieces is captured, your next BASIC throw gets +1 forward movement. | captured piece feeding a delayed boost into the next throw |
| AUG-008 | 막판 스퍼트 | Silver | either | When 3 pieces have finished, the last remaining piece gets +1 forward movement. | three finished markers + one final accelerated piece |
| AUG-009 | 걸작 | Silver | either | GEOL moves 4 cells instead of 3 while remaining GEOL. | GEOL glyph with extended movement trail |
| AUG-010 | 후진 가속 | Silver | either | A successful BACKDO reverse move grants a separate 1-cell movement token usable on a chosen piece. | backward move creating a small secondary move token |
| AUG-011 | 반격의 서막 | Silver | either | On the turn after being captured, roll the first BASIC throw twice and choose one result. | capture recoil + delayed double throw + choice fork |
| AUG-012 | 아깝다 | Silver | either | Up to 2 times per game, a BASIC DO may be discarded and rerolled. | DO glyph inside reroll loop with limited charges |
| AUG-013 | 자리비움 | Silver | first | Skip 2 rounds. On the return turn gain 1 extra throw, then keep +1 forward movement for the rest of the game. | empty turns leading into return burst and persistent speed |
| AUG-014 | 나 홀로 집에 | Silver | either | A piece that lands exactly on a junction gains +1 on that piece's next forward move. | lone piece on junction storing a movement charge |
| AUG-015 | 무임승차 | Prism | either | After moving, pull one allied group from 1 cell ahead or behind and stack it; the resulting stack may contain at most 2 pieces. | moving piece pulling a nearby ally into a 2-piece stack |
| AUG-016 | 낙! | Silver | either | While any player owns this, every BASIC throw has a 5% NAK chance. The owner gets a 1-cell movement token when their own throw is NAK. | interrupted throw / falling yut + small compensation move token |
| AUG-017 | 개판 | Prism | either | GAE grants extra throws instead of YUT/MO. GAE extra throws are capped at 2 per turn, and own stacks are capped at 2 pieces. | GAE result taking over the bonus-throw loop + 2-piece stack cap |
| AUG-018 | 도개걸윷모 | Gold | either | Next 5 BASIC throws are fixed in DO → GAE → GEOL → YUT → MO order. | five result glyphs in forward sequence |
| AUG-019 | 모윷걸개도 | Gold | either | Next 5 BASIC throws are fixed in MO → YUT → GEOL → GAE → DO order. | five result glyphs in reverse sequence |
| AUG-020 | 모 아니면 도 | Gold | either | For 3 rounds after acquisition, BASIC throws are 50% MO and 50% DO. | MO and DO as a strict two-way choice |
| AUG-021 | 골목대장 | Silver | either | Landing exactly on a junction can block one opponent passage and stop that opponent immediately before the junction. | guarded junction with one-use roadblock |
| AUG-022 | 자리 맡아놨어 | Gold | either | While one piece guards a junction alone, your other pieces gain +1 forward movement. | stationary junction keeper boosting other moving pieces |
| AUG-023 | 일심동체 1 | Gold | either | A stack of 2+ own pieces gains +1 forward movement. | allied stack with unified forward boost |
| AUG-024 | 칸은 숫자에 불과하다 1 | Gold | either | Split one positive movement result exactly into two movements used by two different pieces. | one move path dividing into two piece paths |
| AUG-025 | 추격자 | Silver | either | Stop early on an opponent encountered along the route to capture it; this chase capture grants no extra throw. | pursuit path terminating early at a capture target |
| AUG-026 | 보험 들었습니다 | Gold | either | When your 2+ piece stack is captured, 1 chosen piece stays on that cell and the rest return to WAITING. | stack breaking with one survivor remaining in place |
| AUG-027 | 물귀신 1 | Gold | either | A group that captures you has its next movement distance fixed to 1 cell. | captor dragged into a one-cell movement limit |
| AUG-028 | 내일의 나에게 | Gold | either | Store one unused movement result until the next turn; the stored movement distance increases by 1. If the restored result has no legal piece that can use it, it expires under the normal unusable-result rule. | move result placed in storage, then returned stronger |
| AUG-029 | 육상선수 | Gold | either | Repeatedly moving the same own group increases its forward movement by +1 each consecutive move, up to +2; switching groups or being captured resets it. | same runner/group building a short acceleration streak |
| AUG-030 | 에이스 | Gold | either | Choose one representative piece on acquisition; any group containing it gains +1 forward movement. | one marked ace piece carrying a group-wide boost |
| AUG-031 | 문워크 | Prism | second | Immediately place all WAITING pieces at random board positions. Afterwards positive movement runs backward and BACKDO runs forward. Win when your original 4 pieces are back under your control in WAITING; temporary Betrayal pieces you are holding do not count. | whole board direction reversed, pieces retreating toward WAITING |
| AUG-032 | 사방신 | Prism | first, natural pool excluded | Win immediately by occupying all 4 outer junctions at the same time, excluding the center. | four outer junctions occupied, center intentionally empty |
| AUG-033 | 우주의 중심 | Prism | first | 4 own pieces stacked at center wins. Center count also gives escalating rewards: 1 piece extra throw; 2 pieces extra throw plus all opponents lose their next movement turn; 3 pieces force the remaining piece to the nearest corner without capture. | center node as escalating gravity hub for 1→4 pieces |
| AUG-034 | 청소부 | Prism | either | For the next 4 moves, capture every opponent on traversed cells and the destination cell. | sweeping route clearing multiple opponent pieces |
| AUG-035 | 일타쌍피 | Prism | either | When capturing on the destination cell, also capture one opponent group 1 cell ahead or behind along the route. | central capture expanding to one adjacent target |
| AUG-036 | 길은 내가 만든다 | Prism | either | You may enter a chosen shortcut when passing a junction without landing exactly on it. | continuous path bending into shortcut while passing junction |
| AUG-037 | 고가도로 | Prism | first | Your pieces move only on the outer route and are immune to augment-driven forced movement or forced relocation. Effects that return pieces to WAITING still apply. | protected elevated outer loop bypassing inner routes and displacement |
| AUG-038 | 대동단결 | Prism | either | Once per game, gather all own pieces currently on the board onto one selected own piece and stack them immediately. | multiple allied pieces converging to one anchor |
| AUG-039 | 양자택일 | Prism | either | Roll every BASIC throw twice and choose one result. | two parallel throw results converging into one choice |
| AUG-040 | 성역 | Prism | either | A piece parked on a junction cannot be captured while it stays there and blocks one opponent passage once. | protected junction with a single-use passage barrier |
| AUG-041 | 독주 | Prism | first | Only one representative piece may be used; complete 3 full laps with it to win. A borrowed Betrayal piece cannot become the runner; if the runner is transferred by Betrayal, a remaining own piece takes over without gaining a free lap. | one highlighted piece circling three lap loops, others inactive |
| AUG-042 | 추노 | Prism | first | Normal victory is replaced by capture count: 7 captures in 2P, 19 in 3P, 30 in 4P. | escalating capture tally / pursuit seal, no literal numbers required |
| AUG-043 | 독불장군 | Prism | either | You may capture your own pieces; capturing an ally grants 2 extra throws. | same-color capture generating a doubled bonus-throw burst |
| AUG-044 | 신의 손 | Prism | first (`not-last`) | Gain 1 charge every 2 BASIC throws; spend a charge to choose the next BASIC result among DO, GAE, GEOL, YUT, MO. | hand selecting one of five throw-result glyphs after charging |
| AUG-045 | 중력 폭발 | Prism | either | Immediately force all board pieces to random inner-route cells, then repeat every 3 rounds. AUG-037 owners are immune. | radial implosion pulling board pieces into inner paths |
| AUG-046 | 뽑기 기계 | Prism | either | Starting 1 round after acquisition and then every 2 rounds, choose any on-board piece and a target cell: 20% lands there, 80% lands on another random cell. No capture on forced landing. AUG-037 pieces are immune. | claw-machine style relocation with chosen target and random scatter |
| AUG-047 | 강해져서 돌아오마 | Gold | first | After the next BASIC throw, gain 1 extra throw; the next augment's tier is upgraded by one step. | delayed return arrow feeding both bonus throw and tier-up |
| AUG-048 | 아수라장 | Silver | either | Immediately acquire a random eligible Gold augment; this card is effectively replaced by the acquired augment. | silver card shattering/replacing into a gold augment symbol |
| AUG-049 | 금빛 아수라장 | Gold | either | Immediately acquire a random eligible Prism augment; this card is effectively replaced by the acquired augment. | gold card transforming into a prism augment symbol |
| AUG-050 | 폭탄! | Prism | first | At the end of Round 5, return every on-board piece to WAITING. The owner receives bonus throws based on opponent groups caught by the reset. | board-wide blast resetting pieces back to start |
| AUG-051 | 대격변 | Prism | second | Immediately reroll every non-immune player's individual piece state into WAITING, random board position, or FINISHED; all stacks break and no capture occurs during relocation. AUG-037 owners are immune. | board state shattered and pieces redistributed among start/board/finish |
| AUG-052 | 메아리 | Silver | first | Save the actual route of your first finished piece; the next 2 newly departing pieces repeat the same junction choices. | completed route echoed by two following pieces |
| AUG-053 | 배반 | Gold | either | Transfer one own WAITING piece to a random opponent. If that betrayed piece captures one of its original owner's pieces, it grants 1 extra throw. If it finishes under the new owner, it returns to the original owner's WAITING pool. | one allied piece switching sides with a return tether to original owner |
| AUG-054 | 도를 아십니까 | Gold | either | DO no longer appears for the owner; BACKDO remains. DO probability is redistributed across GAE, GEOL, YUT, and MO in their original proportions. | DO glyph removed from result wheel while BACKDO remains |
| AUG-055 | 산책로 | Silver | either | One of the 4 outer board segments becomes a random trail. An own piece starting its move from that trail gains +1 forward movement. | one highlighted outer side acting as a speed trail |
| AUG-056 | 웜홀 | Prism | either | Immediately and every 2 rounds, replace a BASIC throw by sending one on-board group into a wormhole. One round later it reappears 3–18 cells ahead at a random valid position. | group entering a portal and reappearing far ahead on the route |
| AUG-057 | 역병 | Gold | either | Capturing an opponent infects that piece for that player's next own turn only. While infected and in WAITING, it may depart only with GEOL, YUT, or MO. | infected piece behind a restricted start gate |
| AUG-058 | 토끼와 거북이 | Gold | first | Move one own WAITING piece to the cell immediately before finish. It cannot move or stack for 3 rounds, but opponents may capture it. | piece placed near finish inside a temporary lock |
| AUG-059 | 여백의 미 | Prism | first | Each time one of your pieces finishes, your remaining pieces need one fewer outer side to finish. Removed sides can no longer be entered. | outer board progressively trimmed as pieces finish |

## Conflicts that matter for visuals and card grouping

- Fixed-roll conflict family: `AUG-011`, `AUG-018`, `AUG-019`, `AUG-020`, `AUG-039`, `AUG-044`.
- `AUG-017` conflicts with `AUG-038`.
- `AUG-029` conflicts with `AUG-042`.
- `AUG-037` conflicts with `AUG-031` and `AUG-033`.
- `AUG-040` conflicts with `AUG-032`.

## Removed / inactive IDs

Do not create new augment assets for these unless they are explicitly reactivated in a later rules change:

- `AUG-060 사냥꾼 2`
- `AUG-061 각자도생`
- `AUG-062 사냥꾼 3`
- `AUG-063 칸은 숫자에 불과하다 2`
- `AUG-064 물귀신 2`
- `AUG-065 일심동체 2`
- `AUG-066` old hitchhiker version
- `AUG-067` is currently unused

## Image-agent checklist

Before generating an augment asset:
1. Read this manifest entry.
2. Check the tier and slot restriction.
3. Express the actual rule, not a pun on the name.
4. Reuse a shared visual language for related mechanics.
5. Keep text and numeric rule copy out of the artwork.
6. If this file conflicts with raw `catalog.ts`, this manifest is the intended post-stack snapshot; verify against the latest patch scripts before changing either source.
