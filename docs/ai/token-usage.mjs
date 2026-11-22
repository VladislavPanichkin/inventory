/**
 * Builds the token usage log from Claude Code session records.
 *
 *   node docs/ai/token-usage.mjs [--until <ISO time>] <session.jsonl> [<sub-agent.jsonl> ...]
 *
 * --until leaves out every response after that moment (for a log "as of" a point in time).
 *
 * Claude Code stores every model response in the session record together with the usage
 * the API reported for it. One response is stored as several records (one per content
 * block) that all carry the same usage, so responses are counted once, by message ID.
 *
 * Writes token-usage.csv (one row per response) and token-usage.md (totals) next to this
 * file. Nothing but timestamps, model names and token counts is read into the output.
 */
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const files = process.argv.slice(2);
let until = null;
if (files[0] === "--until") {
  until = new Date(files[1] ?? "").toISOString();
  files.splice(0, 2);
}
if (files.length === 0) {
  console.error("Usage: node token-usage.mjs [--until <ISO time>] <session.jsonl> [<sub-agent.jsonl> ...]");
  process.exit(1);
}
const outDir = path.dirname(fileURLToPath(import.meta.url));

/** message ID -> one response */
const responses = new Map();
const compactionDays = [];

for (const [index, file] of files.entries()) {
  const source = index === 0 ? "main" : "sub-agent";
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"usage"') && !line.includes("compact_boundary")) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (until && record.timestamp > until) continue;
    if (record.type === "system" && record.subtype === "compact_boundary") {
      compactionDays.push(String(record.timestamp).slice(0, 10));
    }
    const message = record.message;
    if (record.type !== "assistant" || !message?.usage || !message.id) continue;
    // Placeholder responses written by the tool itself, not by a model.
    if (!message.model || message.model.startsWith("<")) continue;

    const usage = message.usage;
    const previous = responses.get(message.id);
    const timestamp = previous && previous.timestamp < record.timestamp ? previous.timestamp : record.timestamp;
    responses.set(message.id, {
      timestamp,
      source,
      model: message.model,
      input: usage.input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      thinking: usage.output_tokens_details?.thinking_tokens ?? 0,
    });
  }
}

const rows = [...responses.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
const fields = ["input", "cacheWrite", "cacheRead", "output", "thinking"];
const zero = () => ({ responses: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 });
const add = (total, row) => {
  total.responses += 1;
  for (const field of fields) total[field] += row[field];
  return total;
};
const groupBy = (key) => {
  const groups = new Map();
  for (const row of rows) add(groups.get(key(row)) ?? groups.set(key(row), zero()).get(key(row)), row);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
};

const compactions = compactionDays.length;
const compactedOn = [...new Set(compactionDays)].sort().join(", ") || "never";
const total = rows.reduce(add, zero());
const byDay = groupBy((row) => row.timestamp.slice(0, 10));
const byModel = groupBy((row) => (row.source === "main" ? row.model : `${row.model} (sub-agent)`));

// ---------- CSV: one row per response ----------
const csv = [
  "timestamp_utc,source,model,input_tokens,cache_write_tokens,cache_read_tokens,output_tokens,thinking_tokens_within_output",
  ...rows.map((row) =>
    [row.timestamp, row.source, row.model, row.input, row.cacheWrite, row.cacheRead, row.output, row.thinking].join(","),
  ),
].join("\n");
await writeFile(path.join(outDir, "token-usage.csv"), `${csv}\n`);

// ---------- Markdown: totals ----------
const n = (value) => value.toLocaleString("en-US");
const allInput = (t) => t.input + t.cacheWrite + t.cacheRead;
const percent = (part, whole) => (whole === 0 ? "0" : ((100 * part) / whole).toFixed(1));
const tableRow = (label, t) =>
  `| ${label} | ${n(t.responses)} | ${n(t.input)} | ${n(t.cacheWrite)} | ${n(t.cacheRead)} | ${n(t.output)} |`;
const tableHead = (first) =>
  `| ${first} | Responses | Input (not cached) | Input written to cache | Input read from cache | Output |\n|---|---:|---:|---:|---:|---:|`;

const requestInput = (row) => row.input + row.cacheWrite + row.cacheRead;
const peak = rows.reduce((max, row) => (requestInput(row) > requestInput(max) ? row : max), rows[0]);
const dayRow = (day, t) => `${tableRow(day, t)} ${n(Math.round(allInput(t) / t.responses))} |`;

const first = rows[0].timestamp;
const last = rows.at(-1).timestamp;
const md = `# Token usage log

Actual token usage of the AI-assisted development of this project, taken from the session
records of the coding tool (Claude Code). Every number is the usage the model API reported
for a response; nothing is estimated.

- Period: ${first.slice(0, 10)} to ${last.slice(0, 10)} (UTC). Last response counted: ${last}.
${until ? `- Cut-off: responses after ${until} are not included (the moment this log was requested).\n` : ""}- Responses counted: ${n(total.responses)} (each counted once).
- Raw data: [token-usage.csv](token-usage.csv), one row per response.
- Method: [token-usage.mjs](token-usage.mjs).

## Totals

| | Tokens |
|---|---:|
| Output (generated by the model, including its reasoning) | ${n(total.output)} |
| — of which reasoning | ${n(total.thinking)} |
| Input, not cached | ${n(total.input)} |
| Input written to cache | ${n(total.cacheWrite)} |
| Input read from cache | ${n(total.cacheRead)} |
| All input processed | ${n(allInput(total))} |

${percent(total.cacheRead, allInput(total))}% of all input was read from the prompt cache.

Average input per request: ${n(Math.round(allInput(total) / total.responses))} tokens. Largest single request: ${n(requestInput(peak))} tokens (${peak.timestamp.slice(0, 10)}).

## How to read the numbers

An AI coding session sends the whole conversation so far with every request, so input
is counted again on each of the ${n(total.responses)} requests. That is why "all input processed" is far
larger than the amount of text ever written. Prompt caching is what keeps this affordable:
input that was already sent is read from the cache at a fraction of the price of new
input. "Input written to cache" is the new material of each request (new messages, files
read, command output); "output" is what the model wrote.

## By day

${tableHead("Day (UTC)").replace("| Output |\n", "| Output | Avg input per request |\n").replace(/$/, "---:|")}
${byDay.map(([day, t]) => dayRow(day, t)).join("\n")}
${dayRow("**Total**", total)}

The last column is the size of the conversation that was sent with each request. It grows
as a session gets longer and drops after the conversation is compacted (${compactions} time${compactions === 1 ? "" : "s"}; on: ${compactedOn}).

## By model

${tableHead("Model")}
${byModel.map(([model, t]) => tableRow(`\`${model}\``, t)).join("\n")}

## What is not in this log

- The conversation was compacted ${compactions} time${compactions === 1 ? "" : "s"} (the tool summarizes a long conversation to free
  up context). The session records do not contain a usage entry for those summarization
  requests, so they are not counted.
- Cost is not shown: the records hold token counts, not prices.
`;
await writeFile(path.join(outDir, "token-usage.md"), md);

console.log(`${n(total.responses)} responses, ${first} .. ${last}`);
console.log(`output ${n(total.output)}, input ${n(total.input)}, cache write ${n(total.cacheWrite)}, cache read ${n(total.cacheRead)}`);
