const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcryptjs");

const db = new Database("./prisma/dev.db");

function toIso(ms) {
  return new Date(ms).toISOString();
}

try {
  console.log("Clearing existing TaskRuns and Agents...");
  db.prepare("DELETE FROM TaskRun").run();
  db.prepare("DELETE FROM Agent").run();

  let user = db.prepare("SELECT * FROM User WHERE email = ?").get("demo@example.com");
  const hash = bcrypt.hashSync("password", 12);
  const nowIso = new Date().toISOString();

  if (!user) {
    user = { id: uuidv4() };
    db.prepare(
      "INSERT INTO User (id, email, name, passwordHash, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(user.id, "demo@example.com", "Demo User", hash, nowIso, nowIso);
  } else {
    db.prepare("UPDATE User SET passwordHash = ?, updatedAt = ? WHERE id = ?").run(hash, nowIso, user.id);
  }

  const userId = user.id;
  const agentsData = [
    { name: "Gemini CLI", alias: "gemini-cli", agentType: "CUSTOM" },
    { name: "Code Reviewer", alias: "reviewer", agentType: "CUSTOM" },
    { name: "Support Bot", alias: "support", agentType: "CUSTOM" },
    { name: "Data Analyst", alias: "analyst", agentType: "CUSTOM" },
    { name: "Release Helper", alias: "release", agentType: "CUSTOM" },
  ];

  const insertAgentStmt = db.prepare(
    "INSERT INTO Agent (id, userId, name, alias, agentType, connectionTier, lastActiveAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 'WEBHOOK', ?, ?, ?)"
  );

  const createdAgents = agentsData.map((agent, idx) => {
    const id = uuidv4();
    const activeAt = toIso(Date.now() - idx * 45 * 60 * 1000);
    insertAgentStmt.run(id, userId, agent.name, agent.alias, agent.agentType, activeAt, nowIso, nowIso);
    return { id, ...agent };
  });

  const baseLogs = [
    "Summarize support incidents and tag priorities",
    "Review PR #241 and leave release-risk notes",
    "Generate daily KPI digest for leadership",
    "Run dependency drift audit and security scan",
    "Draft incident postmortem timeline",
    "Validate webhook replay protection rules",
    "Triage stale backlog tasks older than 14 days",
    "Prepare sprint handoff notes for platform team",
    "Analyze auth failure spikes from overnight logs",
    "Compile release readiness checklist",
  ];

  const insertTaskStmt = db.prepare(
    "INSERT INTO TaskRun (id, userId, agentId, taskBody, status, schedulingMode, scheduledAt, dispatchedAt, startedAt, completedAt, slackMessageTs, timeoutMinutes, pauseCount, totalWaitDuration, totalActiveDuration, failureReason, completionPath, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 'AUTONOMOUS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const now = Date.now();
  const start = now - 14 * 24 * 60 * 60 * 1000;
  let taskCount = 0;

  for (const [agentIndex, agent] of createdAgents.entries()) {
    for (let i = 0; i < 14; i++) {
      const slot = agentIndex * 14 + i;
      const scheduledMs = start + slot * 3 * 60 * 60 * 1000;
      const description = baseLogs[(slot + agentIndex) % baseLogs.length];
      const taskBody = `[${new Date(scheduledMs).toLocaleDateString("en-US")}] ${description} (${agent.alias})`;
      const past = scheduledMs <= now;

      let status = "SCHEDULED";
      let dispatchedAt = null;
      let startedAt = null;
      let completedAt = null;
      let failureReason = null;
      let completionPath = null;
      let pauseCount = 0;
      let totalWaitDuration = 0;
      let totalActiveDuration = 0;

      if (past) {
        const mod = slot % 10;
        if (mod <= 5) {
          status = "COMPLETED";
        } else if (mod === 6) {
          status = "FAILED";
          failureReason = "Rate limit on upstream service";
        } else if (mod === 7) {
          status = "TIMED_OUT";
          failureReason = "Worker exceeded timeout window";
        } else if (mod === 8) {
          status = "WAITING";
          pauseCount = 1;
          totalWaitDuration = 11 * 60;
        } else {
          status = "IN_PROGRESS";
        }

        const dispatchMs = scheduledMs + 2 * 60 * 1000;
        const startMs = dispatchMs + 10 * 1000;
        dispatchedAt = toIso(dispatchMs);
        startedAt = toIso(startMs);
        completionPath = status === "COMPLETED" ? "WEBHOOK" : null;

        if (status === "COMPLETED" || status === "FAILED" || status === "TIMED_OUT") {
          const finishMs = startMs + (12 + (slot % 18)) * 60 * 1000;
          completedAt = toIso(finishMs);
          totalActiveDuration = Math.round((finishMs - startMs) / 1000);
        } else {
          totalActiveDuration = 15 * 60;
        }
      }

      const createdAt = toIso(scheduledMs - 60 * 60 * 1000);
      const updatedAt = completedAt || startedAt || dispatchedAt || toIso(scheduledMs);

      insertTaskStmt.run(
        uuidv4(),
        userId,
        agent.id,
        taskBody,
        status,
        toIso(scheduledMs),
        dispatchedAt,
        startedAt,
        completedAt,
        `demo-${slot}`,
        60,
        pauseCount,
        totalWaitDuration,
        totalActiveDuration,
        failureReason,
        completionPath,
        createdAt,
        updatedAt
      );
      taskCount += 1;
    }
  }

  console.log(`Seeded ${createdAgents.length} agents and ${taskCount} task runs over the last two weeks.`);
  console.log("Demo login: demo@example.com / password");
} catch (err) {
  console.error("Error setting up DB:", err);
} finally {
  db.close();
}
