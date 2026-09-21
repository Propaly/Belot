import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { mulberry32 } from "../src/game/deck.ts";
import {
    decodeGameLog,
    decodePosition,
    describePosition,
    encodePosition,
} from "../src/game/notation.ts";
import { makeAgent, playOut } from "../src/game/playout.ts";
import { replayGame, type GameLog } from "../src/game/replay.ts";
import {
    currentEngineApi,
    legacyEngineApi,
    loadLegacyModule,
} from "./engines.ts";

/**
 * Replay / сравнение старо-ново.
 *
 * Позиция или игра се записва в нотация (вж. src/game/notation.ts) и после
 * може да се пусне върху ТЕКУЩИЯ и върху СТАРИЯ двигател. Така се вижда
 * дали даден бъг още се случва и дали развитието на играта е същото.
 *
 * Примери:
 *   npm run replay -- --file replays/game-1.json
 *   npm run replay -- --all --old
 *   npm run replay -- --position "belot1 B 0 1 0 0-0 ..."
 *   npm run replay -- --position "belot1 ..." --playout --agents random --games 50
 */

function readArg(name: string, fallback: string): string {
    const prefix = `--${name}=`;
    const inline = process.argv.find((a) => a.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = process.argv.indexOf(`--${name}`);
    if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
    return fallback;
}

const readFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const file = readArg("file", "");
const all = readFlag("all");
const dir = resolve(readArg("dir", "replays"));
const withOld = readFlag("old") || readArg("compare", "") === "old";
const base = readArg("base", "HEAD");
const positionText = readArg("position", "");
const doPlayout = readFlag("playout");
const agents = readArg("agents", "smart") as "smart" | "random";
const games = Number(readArg("games", "1"));
const seed = Number(readArg("seed", "1"));

let failures = 0;

function parseLog(text: string): GameLog {
    const trimmed = text.trim();
    if (trimmed.startsWith("{")) return JSON.parse(trimmed) as GameLog;
    return decodeGameLog(trimmed);
}

function scoreText(score: [number, number]): string {
    return `${score[0]}:${score[1]}`;
}

// ------------------------------------------------------------------
// Режим 1: replay на запазени игри (JSON или нотация)
// ------------------------------------------------------------------
function replayLogs(): void {
    const current = currentEngineApi();

    const files = all
        ? existsSync(dir)
            ? readdirSync(dir)
                .filter((f) => f.endsWith(".json") || f.endsWith(".bel"))
                .map((f) => resolve(dir, f))
            : []
        : file
            ? [file]
            : [];

    if (!files.length) {
        console.error("Няма файлове. Дай --file <път> или --all [--dir <папка>].");
        process.exit(2);
    }

    for (const path of files) {
        const log = parseLog(readFileSync(path, "utf8"));
        const cur = replayGame(log, current);

        console.log(path);
        console.log(`  раздавания: ${log.deals.length}`);

        if (!cur.ok) {
            failures += 1;
            console.log(`  текущ код: ГРЕШКА - ${cur.error}`);
            console.log("  => бъгът все още се възпроизвежда на текущия код");
            continue;
        }

        console.log(`  текущ код: ОК, точки ${scoreText(cur.score)}`);

        if (log.result) {
            const same =
                log.result.score[0] === cur.score[0] &&
                log.result.score[1] === cur.score[1];
            console.log(
                `  записан резултат: ${scoreText(log.result.score)} ${
                    same ? "(съвпада)" : "(РАЗЛИКА)"
                }`
            );
        }
    }
}

/** Сравнява записаните игри и със стария двигател. */
async function replayLogsOld(): Promise<void> {
    if (!withOld) return;

    const current = currentEngineApi();
    const mod = await loadLegacyModule(base);
    const old = legacyEngineApi(mod);

    const files = all
        ? existsSync(dir)
            ? readdirSync(dir)
                .filter((f) => f.endsWith(".json") || f.endsWith(".bel"))
                .map((f) => resolve(dir, f))
            : []
        : file
            ? [file]
            : [];

    for (const path of files) {
        const log = parseLog(readFileSync(path, "utf8"));
        const cur = replayGame(log, current);
        if (!cur.ok) continue;

        const oldOut = replayGame(log, old);
        console.log(`  [стар] ${path}`);

        if (!oldOut.ok) {
            console.log(`    стар код: ГРЕШКА - ${oldOut.error} (очаквано за стар бъг)`);
            continue;
        }

        const sameGameplay = oldOut.checksum === cur.checksum;
        const sameScore = scoreText(oldOut.score) === scoreText(cur.score);

        console.log(`    стар код:  ОК, точки ${scoreText(oldOut.score)}`);
        console.log(
            `    развитие:  ${sameGameplay ? "същото" : "РАЗЛИКА <= регресия!"}`
        );
        if (!sameScore) {
            console.log(
                `    точки:     разлика (стар ${scoreText(oldOut.score)} -> нов ${scoreText(cur.score)})`
            );
        }
        if (!sameGameplay) failures += 1;
    }
}

// ------------------------------------------------------------------
// Режим 2: позиция (евентуално изиграна напред с агенти)
// ------------------------------------------------------------------
async function replayPosition(): Promise<void> {
    const state = decodePosition(positionText);
    console.log(describePosition(state));
    console.log("");
    console.log("Нотация:");
    console.log(encodePosition(state));

    if (!doPlayout) return;

    const current = currentEngineApi();
    const oldMod = withOld ? await loadLegacyModule(base) : null;
    const oldApi = oldMod ? legacyEngineApi(oldMod) : null;

    console.log("");
    console.log(
        `Изиграване с агенти "${agents}" x ${games} (seed ${seed}):`
    );

    for (let i = 0; i < games; i++) {
        const gs = (seed + i) >>> 0;
        const curAgents = [0, 1, 2, 3].map((s) =>
            makeAgent(current, agents, mulberry32(gs + s * 1000))
        );

        let cur;
        try {
            cur = playOut(state, current, curAgents);
        } catch (error) {
            failures += 1;
            console.log(`  #${i} текущ код: ГРЕШКА - ${(error as Error).message}`);
            continue;
        }

        const line = `  #${i} seed=${gs} текущ: точки ${scoreText(cur.state.score)} (${cur.steps} стъпки)`;

        if (!oldApi) {
            console.log(line);
            continue;
        }

        const oldAgents = [0, 1, 2, 3].map((s) =>
            makeAgent(oldApi, agents, mulberry32(gs + s * 1000))
        );
        const old = playOut(state, oldApi, oldAgents);

        const same = old.checksum === cur.checksum;
        console.log(`${line} | стар: ${scoreText(old.state.score)} | развитие: ${same ? "същото" : "РАЗЛИКА"}`);
        if (!same) failures += 1;
    }
}

async function main(): Promise<void> {
    if (positionText) {
        await replayPosition();
    } else {
        replayLogs();
        if (withOld) {
            console.log("");
            await replayLogsOld();
        }
    }

    if (failures > 0) {
        console.error(`\n${failures} проблема(а) открити.`);
        process.exit(1);
    }
}

void main();
