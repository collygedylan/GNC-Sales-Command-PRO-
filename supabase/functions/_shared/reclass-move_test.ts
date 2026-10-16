import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { normalizeReclassMoveCommand } from "../../../services/reclassMove.ts";

const source = {
  uniqueId: "reclass-source-1",
  identity: {
    unique_id: "reclass-source-1", itemcode: "ITEM-1", contsize: "#3", locationcode: "C.12.001",
    lotcode: "27.F1", season: "F1", ptronhand: "700", ptravailable: "650",
  },
};

Deno.test("Reclass movement contract accepts bounded split lines and canonicalizes destination season", () => {
  assertEquals(normalizeReclassMoveCommand({
    action: "inventory_reclass_move", commandId: "reclass-command-0001", expectedRevision: 17,
    source, lines: [
      { direction: "move_up", destinationSeason: "u1", quantity: 610 },
      { direction: "move_down", destinationSeason: "S1", quantity: 20 },
    ],
  }), {
    commandId: "reclass-command-0001", expectedRevision: 17, moves: [{ source,
    lines: [
      { direction: "move_up", destinationSeason: "U1", quantity: 610 },
      { direction: "move_down", destinationSeason: "S1", quantity: 20 },
    ] }],
  });
});

Deno.test("Reclass movement contract accepts atomic multi-source batches and single-source compatibility", () => {
  const command = { action: "inventory_reclass_move", commandId: "reclass-command-0002", expectedRevision: 17,
    moves: [{ source, lines: [{ direction: "move_up", destinationSeason: "U1", quantity: 10 }] },
      { source: { uniqueId: "reclass-source-2", identity: { ...source.identity, unique_id: "reclass-source-2", itemcode: "ITEM-2" } },
        lines: [{ direction: "move_down", destinationSeason: "S1", quantity: 20 }] }] };
  assertEquals(normalizeReclassMoveCommand(command).moves.length, 2);
  assertEquals(normalizeReclassMoveCommand({ ...command, moves: undefined, source, lines: command.moves[0].lines }).moves.length, 1);
  assertThrows(() => normalizeReclassMoveCommand({ ...command, moves: [command.moves[0], command.moves[0]] }));
});

Deno.test("Reclass source identity preserves literal source values", () => {
  const literalSource = { uniqueId: " reclass-source-3 ", identity: {
    ...source.identity, unique_id: " reclass-source-3 ", itemcode: " ITEM-3 ", contsize: "",
  } };
  const normalized = normalizeReclassMoveCommand({ action: "inventory_reclass_move",
    commandId: "reclass-command-0003", expectedRevision: 17, source: literalSource,
    lines: [{ direction: "move_up", destinationSeason: "U1", quantity: 1 }] });
  assertEquals(normalized.moves[0].source.identity.itemcode, " ITEM-3 ");
  assertEquals(normalized.moves[0].source.identity.contsize, "");
  assertEquals(normalized.moves[0].source.uniqueId, " reclass-source-3 ");
});

Deno.test("Reclass movement contract rejects extra keys, stale/malformed quantities, and unsupported seasons", () => {
  const valid = { action: "inventory_reclass_move", commandId: "reclass-command-0001", expectedRevision: 17, source,
    lines: [{ direction: "move_up", destinationSeason: "U1", quantity: 610 }] };
  for (const invalid of [
    { ...valid, actorId: "forged" },
    { ...valid, expectedRevision: 0 },
    { ...valid, source: { ...source, identity: { ...source.identity, ptronhand: {} } } },
    { ...valid, source: { ...source, identity: { ...source.identity, unexpected: "value" } } },
    { ...valid, lines: [{ direction: "move_up", destinationSeason: "U1", quantity: 610.5 }] },
    { ...valid, lines: [{ direction: "move_up", destinationSeason: "Q1", quantity: 610 }] },
    { ...valid, lines: Array.from({ length: 101 }, () => valid.lines[0]) },
  ]) assertThrows(() => normalizeReclassMoveCommand(invalid));
});
