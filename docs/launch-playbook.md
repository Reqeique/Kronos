# Kronos Launch Playbook

## Hacker News Draft

### Suggested Title
`Show HN: Kronos - schedule and monitor AI agent work as calendar blocks`

### Suggested Post Body
```md
Hey HN - I built Kronos, a dashboard + CLI for running AI agent jobs and visualizing them as calendar time blocks.

What it does:
- Schedule tasks for agent aliases
- Dispatch and track lifecycle states (scheduled -> in progress -> completed/failed/timed out)
- View agent work by day/week/month in a calendar UI
- Use a local CLI bridge (`kronos`) to send execution lifecycle events back to the dashboard
- Stream task delivery to workers via `/api/bridge/tasks` (streamable HTTP)
- Use `@` file mention autocomplete in task descriptions plus CLI prompt mention preprocessing

Why I built it:
Agent runs are often fire-and-forget. I wanted a way to see where agent time goes and coordinate it like scheduled work.

Stack:
Next.js + TypeScript + Prisma + Schedule-X calendar + CLI bridge

Would love feedback on:
1. Which part is most useful in your workflow?
2. What is missing for daily use?
3. Should this stay self-hosted-first, or include a hosted tier?

Demo: <your demo URL>
Repo: <your GitHub URL>
```

## Marketing Methods

### 1. Hacker News (`Show HN`)
- Post with the title format above.
- Keep the post factual and brief.
- Include demo + repo links.
- Stay active in comments for the first 2-3 hours.

### 2. Product Hunt
- Create a launch page with:
  - one-line value prop
  - 3 core features
  - short GIF/video
  - clear CTA (demo/repo/waitlist)
- Ask 5-10 users/friends to leave honest early feedback.

### 3. Peerlist Launchpad
- Repurpose Product Hunt assets.
- Focus copy on developer workflow and concrete outcomes.

### 4. BetaList
- Submit for startup/tool discovery traffic.
- Good for ongoing inbound after launch day.

### 5. X/Twitter + LinkedIn (Founder Distribution)
- Post a short thread:
  - problem
  - 10-second demo clip
  - what makes Kronos different
  - link to demo/repo
- Repost 24h and 72h later with a customer/use-case angle.

### 6. Developer Communities (Targeted)
- Share in relevant communities where AI-agent builders hang out:
  - Reddit (relevant subreddits)
  - Discord/Slack communities
  - Indie Hackers build logs
- Do not spam: tailor message per community with one clear use case.

## Release Notes Angle
- Highlight that queue workers now use streamable HTTP by default instead of pure polling.
- Mention backward compatibility: polling mode still available via `--queue-transport polling`.
- Show one short demo clip of `@` autocomplete in New Task and mention resolution in CLI-driven runs.

## Launch Checklist (Quick)
- [ ] Demo URL stable
- [ ] README included
- [ ] Screenshots/GIF current
- [ ] Onboarding path under 10 min
- [ ] Error logs monitored on launch day
- [ ] Comment/reply plan ready for HN + Product Hunt
