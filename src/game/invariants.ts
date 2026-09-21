import type { Contract, GameState } from "../types.ts";
import { createDeck } from "./deck.ts";
import { cardPoints } from "./engine.ts";

function deckPointTotal(contract: Contract): number {
    return createDeck().reduce((sum, card) => sum + cardPoints(card, contract), 0);
}

/**
 * Проверява фундаментални инварианти на състоянието. Връща описание на
 * първия нарушен инвариант, или null, ако всичко е наред. Споделя се от
 * симулациите и replay системата.
 */
export function findInvariantViolation(state: GameState): string | null {
    if (state.players.length !== 4) {
        return `players.length = ${state.players.length}, очаквано 4`;
    }

    for (let i = 0; i < state.players.length; i++) {
        const p = state.players[i];
        if (p.id !== i) return `players[${i}].id = ${p.id}`;
        if (p.team !== (i % 2)) {
            return `players[${i}].team = ${p.team}, очаквано ${i % 2}`;
        }
    }

    if (!["bidding", "playing", "finished"].includes(state.phase)) {
        return `невалидна фаза: ${state.phase}`;
    }

    if (state.currentPlayer < 0 || state.currentPlayer > 3) {
        return `currentPlayer = ${state.currentPlayer}`;
    }

    if (state.trick.length > 4) {
        return `trick.length = ${state.trick.length}`;
    }

    if (![1, 2, 4].includes(state.multiplier)) {
        return `multiplier = ${state.multiplier}`;
    }

    // Всички карти трябва да са уникални и да са точно 32.
    const seen = new Set<string>();
    let cardCount = 0;

    const checkCard = (id: string, where: string): string | null => {
        cardCount += 1;
        if (seen.has(id)) return `дублирана карта ${id} в ${where}`;
        seen.add(id);
        return null;
    };

    for (const card of state.deck) {
        const err = checkCard(card.id, "deck");
        if (err) return err;
    }

    for (const played of state.trick) {
        if (played.playerId < 0 || played.playerId > 3) {
            return `trick card playerId = ${played.playerId}`;
        }
        const err = checkCard(played.card.id, "trick");
        if (err) return err;
    }

    const trickPlayers = new Set(state.trick.map((t) => t.playerId));
    if (trickPlayers.size !== state.trick.length) {
        return "два пъти изиграна карта от един и същ играч в една взятка";
    }

    for (const p of state.players) {
        for (const card of p.hand) {
            const err = checkCard(card.id, `hand на ${p.name}`);
            if (err) return err;
        }
    }

    if (state.phase === "bidding" && cardCount !== 32) {
        return `общо карти при наддаване = ${cardCount}, очаквано 32`;
    }

    if (state.phase === "bidding") {
        for (const p of state.players) {
            if (p.hand.length !== 5) {
                return `при наддаване ${p.name} има ${p.hand.length} карти, очаквано 5`;
            }
        }
        if (state.deck.length !== 12) {
            return `при наддаване deck = ${state.deck.length}, очаквано 12`;
        }
    }

    if (state.phase === "playing") {
        if (!state.contract) return "playing без договор";

        // След всяка приключила и изчистена взятка 4 карти напускат
        // състоянието (остават само като точки в tricksWon). Завършената,
        // но още неизчистена взятка (trickComplete) е още на масата.
        const clearedTricks =
            state.tricksCount[0] +
            state.tricksCount[1] -
            (state.trickComplete ? 1 : 0);
        const expectedCards = 32 - 4 * clearedTricks;

        if (cardCount !== expectedCards) {
            return `общо карти при игра = ${cardCount}, очаквано ${expectedCards}`;
        }

        const lengths = state.players.map((p) => p.hand.length);
        const max = Math.max(...lengths);
        const min = Math.min(...lengths);

        // Изиграните в текущата взятка играчи имат с 1 по-малко карта.
        if (max - min > 1) {
            return `разлика в ръцете твърде голяма: ${lengths.join("/")}`;
        }

        for (const p of state.players) {
            if (p.hand.length > 8) {
                return `${p.name} има ${p.hand.length} карти (>8)`;
            }
        }

        // Запазване на точките: изиграни + на масата + в ръце + в deck
        // трябва да е точно сборът точки на всичките 32 карти.
        const contract = state.contract as Contract;
        const playedPoints = state.tricksWon[0] + state.tricksWon[1];
        // Когато взятката е завършена (trickComplete), точките ѝ вече са
        // добавени към tricksWon, но картите още стоят на масата - не
        // бива да се броят втори път.
        const tablePoints = state.trickComplete
            ? 0
            : state.trick.reduce(
                (sum, t) => sum + cardPoints(t.card, contract),
                0
            );
        const handPoints = state.players.reduce(
            (sum, p) =>
                sum +
                p.hand.reduce((s, c) => s + cardPoints(c, contract), 0),
            0
        );
        const deckPoints = state.deck.reduce(
            (sum, c) => sum + cardPoints(c, contract),
            0
        );

        const expected = deckPointTotal(contract);
        const actual = playedPoints + tablePoints + handPoints + deckPoints;

        if (actual !== expected) {
            return `точки не се запазват: ${actual}, очаквано ${expected}`;
        }
    }

    if (!Number.isFinite(state.score[0]) || !Number.isFinite(state.score[1])) {
        return `невалиден резултат: ${state.score[0]}:${state.score[1]}`;
    }

    return null;
}
