/**
 * Looks for things that must not be published in this public repository.
 *
 *   node scan.mjs            # what is staged for the next commit (default)
 *   node scan.mjs --history  # every commit on every branch
 *   node scan.mjs --stdin    # a unified diff on standard input
 *
 * Exit code 1 when something was found. Matches are printed with the middle of the value
 * masked, so running this never copies a secret into the terminal or a log.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const mode = process.argv[2] ?? "--staged";
const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
// Photos and the lock file are large and cannot hold the things looked for here.
const exclude = [":(exclude)backend/assets/demo-photos/*.jpg", ":(exclude)package-lock.json"];

let diff;
let fileNames;
if (mode === "--stdin") {
  diff = readFileSync(0, "utf8");
  fileNames = [];
} else if (mode === "--history") {
  diff = git(["log", "--all", "-p", "-U0", "--format=commit %h", "--", ".", ...exclude]);
  fileNames = git(["log", "--all", "--name-only", "--format="]).split("\n");
} else if (mode === "--staged") {
  diff = git(["diff", "--cached", "-U0", "--", ".", ...exclude]);
  fileNames = git(["diff", "--cached", "--name-only"]).split("\n");
} else {
  console.error("Usage: node scan.mjs [--staged | --history | --stdin]");
  process.exit(2);
}

/** Addresses that are fine to publish: placeholders, GitHub's no-reply, and one-letter test fixtures. */
const allowedEmail = /@(example\.(com|org|net)|users\.noreply\.github\.com|anthropic\.com|b\.co)$/i;

const checks = [
  { kind: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { kind: "JSON web token", pattern: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/ },
  { kind: "eBay keyset ID", pattern: /\b[A-Za-z0-9]+-[A-Za-z0-9]+-(?:PRD|SBX)-[0-9a-f]{9}-[0-9a-f]{8}\b/ },
  { kind: "eBay token", pattern: /v\^1\.1#[A-Za-z0-9^#+/=._-]{60,}/ },
  {
    kind: "database address with a password",
    pattern: /\bpostgres(?:ql)?:\/\/[^:/\s"']+:[^@\s"']{4,}@(?!localhost|127\.0\.0\.1|host\.docker\.internal|postgres\b)[^\s"']+/,
  },
  { kind: "live hosting address", pattern: /\b[a-z0-9-]+\.up\.railway\.app\b/i },
  { kind: "hosting project link", pattern: /railway\.(?:com|app)\/project\/[0-9a-f-]{36}/i },
  { kind: "local home-folder path", pattern: /(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+\// },
  {
    kind: "email address",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    // "user:password@host" inside an address is not an email; the database check covers those.
    skip: (match, line, index) => allowedEmail.test(match) || line[index - 1] === ":" || line[index - 1] === "/",
  },
];

const sensitiveFile = /(^|\/)(\.env(\.(?!example$)[^/]*)?|[^/]*\.(pem|p12|key)|id_(rsa|ed25519)|settings\.local\.json)$/;

const mask = (value) =>
  value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)} (${value.length} characters)`;

const findings = [];
for (const name of new Set(fileNames.filter(Boolean))) {
  if (sensitiveFile.test(name)) findings.push({ kind: "sensitive file", where: name, text: name });
}

let commit = "";
let file = "";
for (const line of diff.split("\n")) {
  if (line.startsWith("commit ")) commit = line.slice(7);
  else if (line.startsWith("+++ ")) file = line.slice(4).replace(/^b\//, "");
  else if (line.startsWith("+") && !line.startsWith("+++")) {
    for (const check of checks) {
      const match = check.pattern.exec(line);
      if (!match || check.skip?.(match[0], line, match.index)) continue;
      findings.push({ kind: check.kind, where: commit ? `${file} (commit ${commit})` : file, text: mask(match[0]) });
    }
  }
}

if (findings.length === 0) {
  console.log(`Nothing found (${mode.slice(2)}).`);
  process.exit(0);
}
const seen = new Set();
for (const finding of findings) {
  const key = `${finding.kind}|${finding.where}|${finding.text}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`${finding.kind.padEnd(34)} ${finding.where}\n    ${finding.text}`);
}
console.log(`\n${seen.size} finding(s). Check each one before committing or pushing.`);
process.exit(1);
