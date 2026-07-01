# Kronos End-to-End Walkthrough

This walkthrough details the steps to set up, execute, and verify the Kronos agent orchestration system with the latest patches.

## Prerequisites

1. Start the Next.js server:
   ```powershell
   npm run dev
   ```
2. Navigate to `http://localhost:3000/settings` and register or log in.
3. Under **Bridge Tokens**, generate a new token and copy it to your clipboard.
4. Save the token locally:
   ```powershell
   npm run kronos login -- --token <YOUR_COPIED_TOKEN> --server http://localhost:3000
   ```

---

## 1. Scheduling a Task from the Website

1. Navigate to the dashboard at `http://localhost:3000/dashboard`.
2. Click **+ New Task** to open the creation dialog.
3. Select an agent alias (e.g., `@oc`).
4. Input a prompt (e.g., `"Name the first capital city in North America. Answer in one sentence."`).
5. Choose a scheduled execution time and click **Schedule Task**.

---

## 2. Running the Agent Listener

Launch the listener using the simplified script alias:
```powershell
npm run agent -- --alias oc --verbose
```

### Flow & Events Logged:
- **`session/new`**: Auto-dispatches the task to the agent process and notifies the server.
- **`session/title`**: Captures the agent-generated session title (e.g., `"Dominican Republic Capital Search"`) and persists it to the database.
- **`session/prompt`**: Streams accumulated agent response chunks character-by-character back to the server.
- **`session/end`**: Ends the session and marks the task status as `COMPLETED`.

---

## 3. Verifying Results

### In the UI:
- The dashboard list, calendar view, and details panels will render the agent-generated **Session Title** (e.g., `"Dominican Republic Capital Search"`) rather than the raw, verbose prompt.
- The sidebar details pane will show the original task description alongside the final agent reply.

### In the SQLite Database:
You can verify the database state directly:
```powershell
sqlite3 prisma/dev.db "SELECT id, status, sessionTitle, latestAgentMessage FROM TaskRun ORDER BY createdAt DESC LIMIT 1;"
```
Output:
```
d963b777-09c1-49c6-b13e-632f477eef5a|COMPLETED|Dominican Republic Capital Search|The first capital city in North America was Santo Domingo, established in 1496 in the Dominican Republic.
```
