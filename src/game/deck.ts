import type { Card, Rank, Suit } from "../types.ts";

export const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];

export const RANKS: Rank[] = [
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
    "A",
];

export function createDeck(): Card[] {
    return SUITS.flatMap((suit) =>
        RANKS.map((rank) => ({
            id: `${suit}-${rank}`,
            suit,
            rank,
        }))
    );
}

/**
 * Източникът на случайност, който shuffle() използва. По подразбиране
 * е Math.random, но тестовете/симулациите могат да го сменят със
 * seeded PRNG, за да могат да възпроизведат точностно дадено раздаване.
 */
let random: () => number = Math.random;

export function setRandom(fn: () => number): void {
    random = fn;
}

export function resetRandom(): void {
    random = Math.random;
}

export function shuffle<T>(items: T[]): T[] {
    const result = [...items];

    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));

        [result[i], result[j]] = [
            result[j],
            result[i],
        ];
    }

    return result;
}

/**
 * Малък seeded PRNG (mulberry32) - дава детерминирана поредица от числа
 * в [0, 1) за даден seed. Ползва се от симулациите, за да може всеки
 * открит бъг да бъде възпроизведен с `--seed`.
 */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;

    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}