// Builds a fake Antigravity home for the Atölye smoke test: critic + news running, task taker failed (no internet), media done.
const fs = require("fs");
const p = require("path");
const R = process.argv[2];
const now = Date.now();
const MIN = 60000;
const ts = (t) => new Date(t).toISOString().slice(0, 19).replace("T", " ");
function mk(name, disp, startAgo, convId, lines, mtimeAgo, model) {
  const sc = p.join(R, "config", "sidecars", name);
  fs.mkdirSync(sc, { recursive: true });
  fs.writeFileSync(p.join(sc, "sidecar.json"), JSON.stringify({ display_name: disp }));
  const lg = p.join(R, "antigravity", "sidecar_data", name, "logs");
  fs.mkdirSync(lg, { recursive: true });
  fs.writeFileSync(p.join(lg, "sidecar.log"), `${ts(now - startAgo)} [schedule] Triggering command: "agentapi" [new-conversation --model=${model} -- Read ANAYASA.md first.\nmore]\n{\n  "response": {\n    "newConversation": {\n      "conversationId": "${convId}"\n    }\n  }\n}\n`);
  const br = p.join(R, "antigravity", "brain", convId, ".system_generated", "logs");
  fs.mkdirSync(br, { recursive: true });
  const f = p.join(br, "transcript.jsonl");
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const m = new Date(now - mtimeAgo);
  fs.utimesSync(f, m, m);
}
mk("critic", "Critic", 3 * MIN, "11111111-1111-1111-1111-111111111111", [{ type: "USER_INPUT" }, { type: "PLANNER_RESPONSE", model: "claude-sonnet-5-5-medium", tool_calls: [{}] }, { type: "GENERIC", status: "DONE" }], 10000, "claude-sonnet-5-5-medium");
// haberler: Antigravity'de "Run Now" ile baslatildi -> zamanlayici kaydinda YOK, yalniz sohbetin ilk mesaji istemle ayni
{
  const prompt = "Read ANAYASA.md, roller/news/rol.md and roller/news/defter.md first. Run no git command.\nFind this week's news that matters to this project.";
  mk("news-and-learning", "News and learning", 2 * MIN, "22222222-2222-2222-2222-222222222222", [{ type: "USER_INPUT", created_at: new Date(now - 2 * MIN).toISOString(), content: "<USER_REQUEST>\n" + prompt + "\n</USER_REQUEST>" }, { type: "PLANNER_RESPONSE", model: "gemini-3.8-flash-medium", tool_calls: [{}] }], 5000, "gemini-3.8-flash-medium");
  const sc = p.join(R, "config", "sidecars", "news-and-learning", "sidecar.json");
  fs.writeFileSync(sc, JSON.stringify({ display_name: "News and learning", args: ["CRON_TZ=Europe/Istanbul 0 21 * * 5", "agentapi", "new-conversation", "--model=gemini-3.8-flash-medium", "--", prompt] }));
  fs.writeFileSync(p.join(R, "antigravity", "sidecar_data", "news-and-learning", "logs", "sidecar.log"), "2026-11-20 10:00:00 [schedule] Scheduler started\n");
}
mk("google-task-taker", "Google task taker", 120 * MIN, "33333333-3333-3333-3333-333333333333", [{ type: "USER_INPUT" }, { type: "ERROR_MESSAGE", error: "dial tcp: lookup x: no such host" }], 60 * MIN, "gemini-4-argon-high");
mk("media-prompts", "Media prompts", 300 * MIN, "44444444-4444-4444-4444-444444444444", [{ type: "USER_INPUT" }, { type: "PLANNER_RESPONSE", model: "gemini-3.8-flash-medium", content: "Bitti" }], 290 * MIN, "gemini-3.8-flash-medium");
