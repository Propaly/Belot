import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeGameLog } from "../src/game/notation.ts";
import {
    formatBug,
    heuristicAgentFactory,
    mixedAgentFactory,
    randomAgentFactory,
    runSimulation,
    type AgentFactory,
} from "../src/game/sim.ts";

function readArg(name: string, fallback: string): string {
    const prefix = `--${name}=`;
    const inline = process.argv.find((a) => a.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);

    const index = process.argv.indexOf(`--${name}`);
    if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];

    return fallback;
}

function readFlag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

const AGENTS: Record<string, AgentFactory> = {
    heuristic: heuristicAgentFactory,
    random: randomAgentFactory,
    mixed: mixedAgentFactory,
};

const games = Number(readArg("games", "200"));
const seed = Number(readArg("seed", "1"));
const agentName = readArg("agents", "heuristic");
const maxSteps = Number(readArg("max-steps", "20000"));
const stopOnBug = readFlag("stop-on-bug");
const outDir = resolve(readArg("out", "sim-reports"));
const saveReplays = readFlag("save-replays");
const replaysDir = resolve(readArg("replays-dir", "replays"));

const agentFactory = AGENTS[agentName];

if (!agentFactory) {
    console.error(
        `Невалиден агент "${agentName}". Избери от: ${Object.keys(AGENTS).join(", ")}`
    );
    process.exit(2);
}

if (!Number.isFinite(games) || games <= 0) {
    console.error("--games трябва да е положително число.");
    process.exit(2);
}

console.log("♠ Белот симулация");
console.log(`  агент:    ${agentName}`);
console.log(`  игри:     ${games}`);
console.log(`  seed:     ${seed}`);
console.log(`  стъпки:   максимум ${maxSteps} на игра`);
console.log("");

const result = runSimulation({
    games,
    seed,
    maxStepsPerGame: maxSteps,
    agentFactory,
    stopOnBug,
    captureReplays: saveReplays,
});

const avgRounds = result.completed
    ? (result.rounds / result.completed).toFixed(2)
    : "—";

console.log("Резултат:");
console.log(`  завършени игри:   ${result.completed}/${result.games}`);
console.log(`  победи отбор 1:   ${result.wins[0]}`);
console.log(`  победи отбор 2:   ${result.wins[1]}`);
console.log(`  раздавания:       ${result.rounds} (средно ${avgRounds})`);
console.log(`  открити бъгове:   ${result.bugs.length}`);
console.log(`  време:            ${(result.durationMs / 1000).toFixed(2)} s`);

if (saveReplays && result.replays.length) {
    mkdirSync(replaysDir, { recursive: true });
    result.replays.forEach((log, i) => {
        const file = `${replaysDir}/game-s${seed}-i${i}.bel`;
        writeFileSync(file, encodeGameLog(log), "utf8");
    });
    console.log(`  записани replay:  ${result.replays.length} в ${replaysDir}/`);
}

if (result.bugs.length) {
    mkdirSync(outDir, { recursive: true });

    const index: string[] = ["# Белот симулация - открити бъгове", ""];

    for (const bug of result.bugs) {
        const file = `${outDir}/bug-seed${bug.seed}-game${bug.gameIndex}-${bug.kind}.txt`;
        const belFile = `${outDir}/bug-seed${bug.seed}-game${bug.gameIndex}-${bug.kind}.bel`;
        writeFileSync(file, formatBug(bug), "utf8");
        writeFileSync(belFile, encodeGameLog(bug.replay), "utf8");
        index.push(`- ${bug.kind}: ${bug.detail}`);
        index.push(`  - seed=${bug.seed}, game=${bug.gameIndex}, round=${bug.round}`);
        index.push(`  - файл: ${file} (replay: ${belFile})`);
        console.log("");
        console.log(formatBug(bug).split("\n").slice(0, 14).join("\n"));
    }

    index.push("");
    index.push("Възпроизвеждане:");
    index.push(
        `  npm run sim -- --agents ${agentName} --games 1 --seed ${result.bugs[0].seed} --stop-on-bug`
    );
    index.push(`  npm run replay -- --file <файл>.bel --old`);
    writeFileSync(`${outDir}/index.md`, index.join("\n"), "utf8");

    console.log("");
    console.log(`Пълен отчет: ${outDir}/index.md`);
    process.exit(1);
}

console.log("");
console.log("Няма открити бъгове.");
