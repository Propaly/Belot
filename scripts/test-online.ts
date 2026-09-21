import WebSocket from "ws";
import { chooseBid, chooseCard } from "../src/game/engine.ts";
import type { GameState } from "../src/types.ts";

/**
 * End-to-end тест на онлайн сървъра:
 *  - създава стая само с 1 клиент; празните седалки се играят от ботове
 *    (проверка, че играта НЕ "виси");
 *  - играе докрай;
 *  - проверява, че имената не се разместват;
 *  - проверява, че завършената игра се записва в SQLite историята.
 */

const url = process.env.WS_URL ?? "ws://localhost:8787";
const api = process.env.API_URL ?? url.replace(/^ws/, "http");

const ws = new WebSocket(url);
let mySeat = 0;
let maxRound = 1;
let nameStable = true;
let actions = 0;
let lastGame: GameState | null = null;
let gatedOk = false;
let initialCount = 0;

const hardTimeout = setTimeout(() => {
  console.error("✗ ТАЙМАУТ: играта изглежда блокира (hang).");
  process.exit(1);
}, 90000);

function done(code: number, message: string) {
  clearTimeout(hardTimeout);
  ws.close();
  console.log(message);
  process.exit(code);
}

ws.on("open", async () => {
  const before = (await fetch(`${api}/api/history`).then((r) => r.json())) as unknown[];
  initialCount = Array.isArray(before) ? before.length : 0;
  ws.send(JSON.stringify({ type: "create", name: "Тест", seat: 0 }));
});

ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "room") {
    mySeat = msg.seat;

    // Проверка: ПРЕДИ старт ботовете не бива да играят - играта чака хора.
    setTimeout(() => {
      gatedOk = !!lastGame && lastGame.bidHistory.length === 0 && lastGame.round === 1;
      console.log(`  ${gatedOk ? "✓" : "✗"} преди старт няма изиграни обяви (чака играчи)`);
      ws.send(JSON.stringify({ type: "start" }));
    }, 1500);
    return;
  }
  if (msg.type !== "state" || !msg.game) return;

  const game = msg.game as GameState;
  lastGame = game;

  if (game.players[mySeat]?.name !== "Тест") {
    nameStable = false;
  }
  maxRound = Math.max(maxRound, game.round);

  if (game.finished) {
    // Даваме на сървъра да запише играта в SQLite.
    setTimeout(async () => {
      const history = await fetch(`${api}/api/history`).then((r) => r.json() as Promise<unknown[]>);
      const count = Array.isArray(history) ? history.length : 0;
      const saved = count === initialCount + 1; // точно ЕДИН нов запис (без дублиране)
      console.log(`  изиграни действия: ${actions}, раздавания: ${maxRound}`);
      console.log(`  ${nameStable ? "✓" : "✗"} името на играча остава "Тест" през цялата игра`);
      console.log(`  ${saved ? "✓" : "✗"} завършената игра е записана точно веднъж (${initialCount} -> ${count})`);

      if (!nameStable || !saved || !gatedOk) done(1, "\n✗ Онлайн тестът се провали.");
      done(0, "\nОнлайн тестът мина (без hang, имената са стабилни, играта е записана).");
    }, 1000);
    return;
  }

  // Играем само на своята седалка; празните се играят от сървъра.
  if (game.phase === "bidding" && game.biddingTurn === mySeat) {
    actions += 1;
    ws.send(JSON.stringify({ type: "call", call: chooseBid(game, mySeat) }));
  } else if (game.phase === "playing" && !game.trickComplete && game.currentPlayer === mySeat) {
    const cardId = chooseCard(game, mySeat);
    if (cardId) {
      actions += 1;
      ws.send(JSON.stringify({ type: "play", cardId }));
    }
  }
});

ws.on("error", (err) => {
  console.error("WS грешка:", err.message);
  process.exit(1);
});
