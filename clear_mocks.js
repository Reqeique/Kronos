const Database = require('better-sqlite3');
const db = new Database('./prisma/dev.db');

try {
    console.log("Cleaning up mock data...");
    const agentResult = db.prepare('DELETE FROM Agent').run();
    const taskResult = db.prepare('DELETE FROM TaskRun').run();

    // We leave the user alone so they can still log in, but the tasks/agents are gone.
    console.log(`Deleted ${agentResult.changes} Agents and ${taskResult.changes} TaskRuns.`);
} catch (err) {
    console.error("Error clearing DB:", err);
} finally {
    db.close();
}
