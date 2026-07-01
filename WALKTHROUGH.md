# Kronos End-to-End Walkthrough

This walkthrough details the steps to set up, execute, and verify the Kronos agent orchestration system with the latest patches.

## Prerequisites

1. Initialize and build the production Next.js application:
   ```powershell
   npm run build
   npm run start
   ```
2. In another terminal, generate your 30-day bridge token:
   ```powershell
   node -e "
     const c=require('node:crypto'), s=process.env.NEXTAUTH_SECRET||'kronos-dev-bridge-secret';
     const p={userId:'350ccc0b-6eae-4e5d-970b-c5f9b772c1d9',exp:Math.floor(Date.now()/1000)+2592000};
     const enc=Buffer.from(JSON.stringify(p)).toString('base64url');
     console.log(enc+'.'+c.createHmac('sha256',s).update(enc).digest().toString('base64url'));
   " --env-file .env
   ```

---

## 1. Scheduling a Task from the Website

1. Navigate to the dashboard at `http://localhost:3000/dashboard`.
2. Click **+ New Task** to open the creation dialog.
3. Select the `@gemini-cli` agent alias.
4. Input a prompt (e.g., `"Name the first capital city in North America. Answer in one sentence."`).
5. Choose a scheduled execution time (e.g., 1 minute in the future) and click **Schedule Task**.

---

## 2. Dispatching the Task via the CLI

Run the CLI watcher process using the bridge token generated above:
```powershell
node ./cli/kronos.js watch-stdio \
  --drive-acp --agent "opencode acp" \
  --alias gemini-cli --token <BRIDGE_TOKEN> \
  --server http://localhost:3000 \
  --verbose
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
