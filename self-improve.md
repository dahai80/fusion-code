# Fusion-Code Self-Improve Roadmap

> Based on deep analysis of 25+ leaked AI system prompts (CL4R1T4S) + 4 open source repos (superpowers, everything-claude-code, claude-loop, learn-claude-code). Aggressive, forward-looking, incrementally implementable.

---

## P0: Core Differentiators — Build the Unfair Advantage

These are features no other CLI coding tool has, or has done poorly. Fusion-Code's unique position: **local MLX + CLI + plugin system + voice**. Lean into it.

### 0.1 Multi-Tier Model Router (Inspired by: Cursor dual-model, Devin think tool, Anthropic Mythos tier)

**Problem**: Every query hits the same model. Wasteful for trivial tasks, underpowered for complex ones.

**Design**:
```
Task Classification → Model Tier Routing:
  - trivial (status check, file read, git log)     → local MLX small model (Qwen2.5-Coder-0.5B)
  - standard (edit, search, refactor)               → local MLX main model (Qwen2.5-Coder-7B)
  - complex (architecture, planning, debugging)     → local MLX large model or cloud API
  - safety-critical (delete, deploy, merge)         → cloud API with confirmation
```

**Key insight from Cursor**: `edit_file` uses a cheaper "apply model", `reapply` escalates to the smarter model when edits fail. Fusion-Code should:
1. Attempt edits with the cheap local model
2. Auto-escalate to the larger model on 2 consecutive failures
3. Log the escalation pattern to improve routing heuristics

**Key insight from Devin**: Mandatory `think` tool use before git decisions, before transitioning from planning, before completion. Implement as a forced "reflection step" that runs on the large model while the main work runs on the small one.

**Implementation**:
- Add `ModelRouter` class in `src/services/api/model-router.ts`
- Classify queries via lightweight heuristics (token count, tool chain depth, keyword matching)
- Configurable routing rules in `~/.fusion-code/model-routes.json`
- Escalation metrics logged to `~/.fusion-code/metrics/`

---

### 0.2 Structured Persistent Memory V2 (Inspired by: Anthropic memory filesystem, Windsurf create_memory)

**Current state**: Fusion-Code has flat memory files in `~/.claude/projects/.../memory/`.

**Upgrade to Anthropic-level**:

```
~/.fusion-code/memory/
├── profile.md              # User identity, expertise, preferences
├── preferences.md          # Coding style, tool preferences, tone
├── topics/
│   ├── rust-async.md       # Per-subject knowledge
│   └── ml-training.md
├── areas/
│   ├── frontend.md         # Domain expertise areas
│   └── devops.md
├── people/
│   └── team-contacts.md    # Team context
└── projects/
    └── fusion-code.md      # Project-specific accumulated knowledge
```

**Key features from Anthropic**:
- **Version guards**: Each file gets a version token; concurrent writes detected and merged
- **Privacy filter**: Before writing, strip PII (race, religion, health, exact addresses, financial amounts)
- **`[stated]` vs `[observed]` tags**: Distinguish what the user said vs what was inferred
- **`if_version` conflict resolution**: Prevents overwriting unseen changes
- **Search**: `memory_search` tool with semantic + keyword matching across all memory files

**Implementation**:
- Refactor `src/memory/` to support hierarchical paths
- Add `MemorySearch` tool (local embedding search over memory files)
- Add version tokens to memory file frontmatter
- Privacy filter as a write-time sanitizer

---

### 0.3 AGENTS.md Cascading Spec (Inspired by: OpenAI Codex AGENTS.md, Anthropic SKILL.md)

**Problem**: Project instructions are flat (one CLAUDE.md). No per-directory context.

**Design**:
```
repo/
├── AGENTS.md                    # Root-level rules
├── src/
│   ├── AGENTS.md               # Frontend-specific rules
│   ├── components/
│   │   └── AGENTS.md           # Component patterns
│   └── services/
│       └── AGENTS.md           # Service layer patterns
└── tests/
    └── AGENTS.md               # Testing conventions
```

**Rules from Codex**:
- More-deeply-nested AGENTS.md takes precedence
- Must run programmatic checks before marking complete
- Citations format: `F:file_path†Lstart-Lend`

**Rules from Anthropic SKILL.md**:
- Reading the relevant AGENTS.md is **mandatory** before creating files/code in that directory
- Skills encode environment-specific constraints not in training data
- Multiple skills may apply to one task

**Implementation**:
- Add `agentsMdResolver` in `src/services/agents-md/`
- On file creation/edit, walk up from target directory to root, merge all AGENTS.md with innermost winning
- Cache resolved AGENTS.md per directory tree
- Expose as `/agents` command to view current effective rules

---

### 0.4 Planning Mode Toggle (Inspired by: Devin planning/standard/edit, Cline ACT/PLAN)

**Problem**: LLM jumps to implementation before understanding. No explicit mode separation.

**Design**:
```
/plan          → Enter PLAN mode: information gathering, architecture, no edits
/act           → Enter ACT mode: implementation, file edits, tool execution
/plan:act      → Auto-transition: plan first, then act (default for complex tasks)
```

**Devin's mandatory think triggers** (adapt for Fusion-Code):
- Before any `git commit/push/merge` → force reflection step
- Before transitioning from PLAN to ACT → require explicit user approval
- Before marking task complete → verify against original requirements

**Cline's context handoff**:
- `new_task` tool: freeze current context into a summary, start fresh with the summary as seed
- Prevents context window degradation on long tasks

**Implementation**:
- Add mode state to `QueryEngine`
- PLAN mode: disable file write tools, enable search/read/think
- ACT mode: all tools enabled
- `/handoff` command: compact current context, start new conversation with summary

---

## P1: Intelligence Amplifiers — Make Every Query Smarter

### 1.1 Search-First Intelligence (Inspired by: Anthropic Opus 4.7 search_first, Grok continuous knowledge)

**Problem**: LLM answers from stale training data. Never checks current state.

**Design**:
- For any factual question about current state (versions, APIs, libraries, current roles): **auto-search before answering**
- Confidence is NOT an excuse to skip search
- Integrate web search as a first-class tool with automatic triggering

**Grok insight**: "Knowledge continuously updated — no strict knowledge cutoff." Fusion-Code with MLX can't do real-time web, but CAN:
1. Cache recent search results locally
2. Pre-index project documentation
3. Auto-fetch package docs from npm/pypi when imports are detected

**Implementation**:
- Add `SearchFirstClassifier` — classifies queries into: `never_search`, `search_if_stale`, `search_if_unsure`, `always_search`
- Integrate with existing web tools
- Auto-trigger search for: library versions, API changes, current events affecting code
- Local doc cache in `~/.fusion-code/doc-cache/`

---

### 1.2 Tool Discovery & Deferred Loading (Inspired by: Anthropic tool_discovery, MCP-first)

**Problem**: All tools loaded upfront. Context window polluted with tool schemas rarely used.

**Design**:
- Core tools (read, write, bash, search) always loaded
- Extended tools (MCP servers, plugins) loaded on-demand via `tool_search`
- `tool_search` is "essentially free" — no cost until tool is actually invoked
- MCP-first: check connected MCP tools BEFORE reaching for browser

**Implementation**:
- Refactor tool registration in `src/tools.ts` to support lazy loading
- Add `tool_search` as a meta-tool
- MCP tool schemas loaded on first reference, cached for session
- Tool usage metrics to identify which tools should be core vs deferred

---

### 1.3 Conversation Search (Inspired by: Anthropic past_chats_tools)

**Problem**: Each session starts from scratch. No way to find "that thing we discussed last week."

**Design**:
- `conversation_search` — find past sessions by topic keywords
- `recent_chats` — find sessions by time window
- Cues: possessives without context ("my project"), definite articles ("the bug"), past tense ("you recommended")

**Key rules from Anthropic**:
- Search before saying "I don't see any previous conversation about that"
- Query needs content nouns, not meta-words ("discuss" → bad, "Chinese robots" → good)
- Track provenance: distinguish user decisions from LLM suggestions
- Summaries are less reliable than transcripts — prefer transcript wording

**Implementation**:
- Index conversation history in `~/.fusion-code/conversations/`
- Lightweight local search (SQLite FTS5 or similar)
- Add `/history search <query>` and `/history recent` commands
- Auto-trigger on detected past-reference cues

---

### 1.4 Adaptive Response Style (Inspired by: Anthropic UserStyle Modes, Meta Muse personality)

**Problem**: One-size-fits-all response style. Power users want concise; learners want explanation.

**Design**:
```
/style concise    → Token-efficient, no hedging, code-first
/style explain    → Teacher-like, explains why, shows alternatives
/style formal     → Business-appropriate, structured, citation-heavy
/style auto       → Adapt based on user expertise (detected from code patterns)
```

**Meta Muse insight**: "Simplification without request is condescension wearing a helpful mask." When ambiguous, assume intelligence. Only simplify on explicit request.

**Implementation**:
- Add style preference to user profile memory
- System prompt modifier based on active style
- Auto-detect: if user types short commands → lean concise; if asks "why" → lean explain
- Persist in `~/.fusion-code/preferences.md`

---

## P2: Workflow Accelerators — Speed Up the Development Loop

### 2.1 Live Preview Integration (Inspired by: Same Dev, Lovable, Bolt WebContainer)

**Problem**: No way to see running app state. Edit → save → switch to browser → refresh cycle.

**Design**:
- Detect running dev servers (Vite, Next.js, etc.)
- Capture console output + errors from running process
- Browser preview in supported terminals (iTerm2, Kitty)
- Auto-correlate errors with recent edits

**Same Dev insight**: "USER can see a live preview in an iframe while you make code changes." + "Start the dev server early so you can work with runtime errors."

**Lovable insight**: "You can access the console logs of the application in order to debug." — inject console log capture.

**Implementation**:
- Add `DevServerMonitor` in `src/services/dev-server/`
- Parse running process output for errors/warnings
- `/preview` command to open browser or terminal preview
- Error correlation engine: match runtime errors to recent file edits

---

### 2.2 One-Command Deploy (Inspired by: Same Dev versioning + Netlify, Windsurf deploy_web_app, Bolt deployment)

**Problem**: Deploy is multi-step and error-prone.

**Design**:
```
/deploy              → Auto-detect platform, deploy current state
/deploy staging      → Deploy to staging environment
/deploy --platform=netlify
/deploy --platform=vercel
/deploy --platform=cloudflare
```

**Same Dev insight**: Version before deploying. Read `netlify.toml` and validate build config.

**Windsurf insight**: `deploy_web_app` as a first-class tool with status tracking.

**Implementation**:
- Add deployment adapters in `src/services/deploy/`
- Platform detection from project config files
- Pre-deploy validation (build check, env vars, config)
- Post-deploy verification (health check, URL confirmation)
- `/version` command to checkpoint before deploy

---

### 2.3 Suggested Actions (Inspired by: Vercel v0 Suggested Actions, Windsurf suggested_responses)

**Problem**: After each response, user must figure out what to do next. No momentum.

**Design**:
- After each response, suggest 3-5 follow-up actions
- Actions are context-aware: based on what was just done, what's pending
- One-key shortcuts: press `1-5` to execute a suggestion

**v0 insight**: "3-5 follow-up actions after each response." Not just suggestions — actionable shortcuts.

**Implementation**:
- Add `SuggestionEngine` in `src/services/suggestions/`
- Suggestion types: next edit, test, deploy, fix, research
- Render as numbered list in REPL after each response
- Keybinding `1-5` to execute suggestion

---

### 2.4 Event Stream & Progress Reporting (Inspired by: Manus event stream, Replit report_progress, Devin command_status)

**Problem**: Long operations are opaque. User doesn't know what's happening.

**Design**:
```
Event types:
  Message   → User/assistant communication
  Action    → Tool invocation (with status: pending/running/done/failed)
  Plan      → Step-by-step plan being executed
  Progress  → Percentage/step completion
  Checkpoint→ Intermediate state save
```

**Manus insight**: Typed events with Planner, Knowledge, Datasource modules. `notify` = non-blocking, `ask` = blocking.

**Replit insight**: `report_progress` tool for non-technical users. `web_application_feedback_tool` with screenshots.

**Devin insight**: `command_status` with `OutputPriority` (CRITICAL/INFO/DEBUG).

**Implementation**:
- Add `EventStream` in `src/services/events/`
- Events emitted by all tools and QueryEngine
- UI renders event stream as progress indicators
- `/progress` command to see current task status
- Checkpoint events enable resume-after-crash

---

## P3: Safety & Quality — Prevent Mistakes Before They Happen

### 3.1 Runtime Reminders (Inspired by: Anthropic reminder system)

**Problem**: LLM forgets rules mid-conversation. Context window fills up, guidelines fade.

**Design**:
- Classifier-based reminders injected at conversation boundaries
- Reminder types:
  - `git_reminder`: Before any destructive git operation
  - `scope_reminder`: When task creeps beyond original request
  - `context_reminder`: When conversation is getting long (>50% context window)
  - `security_reminder`: When handling secrets, credentials, env vars
  - `test_reminder`: When code changes lack test verification

**Implementation**:
- Add `ReminderClassifier` in `src/services/reminders/`
- Inject reminder as system message before LLM call
- Configurable: users can disable specific reminder types
- Log reminder triggers for analytics

---

### 3.2 Copyright-Aware Code Generation (Inspired by: Anthropic CRITICAL_COPYRIGHT_COMPLIANCE)

**Problem**: LLM may reproduce copyrighted code from training data. License contamination.

**Design**:
- Before generating >10 lines of code, check against known license patterns
- Flag code that closely matches known open-source implementations
- Auto-add license attribution when detected
- Strict quotation rules: paraphrase rather than quote from search results

**Anthropic insight**: "Copyright compliance is NON-NEGOTIABLE. 15+ words from one source is a SEVERE VIOLATION. One quote per source maximum."

**Implementation**:
- Add `LicenseChecker` in `src/services/license-check/`
- Pattern matching against known license headers
- Integration with code generation pipeline
- Warning display before insertion of potentially licensed code

---

### 3.3 Privacy-First Memory (Inspired by: Anthropic privacy requirements, OPUS-5 protected attributes)

**Problem**: Memory files may accidentally store sensitive information.

**Design**:
- Protected attributes: race, religion, sexual orientation, health, political affiliation, financial data
- Write-time sanitizer strips or generalizes sensitive data
- Memory access control: project-scoped vs global
- Memory audit trail: who wrote what, when

**Anthropic insight**: Protected attributes (race, religion, sexual orientation, immigration status, disability, union membership, health diagnoses, medications, therapy, political affiliation, exact dollar amounts, home addresses, names of family/children, government IDs, payment card numbers).

**Implementation**:
- Add `PrivacySanitizer` in `src/services/privacy/`
- Regex + heuristic-based detection of protected attributes
- Sanitization before memory write
- `/memory audit` command to review stored data

---

## P4: Advanced Capabilities — The Next Frontier

### 4.1 Code Execution Sandbox (Inspired by: Grok code_execution, Meta container, Mistral code_interpreter)

**Problem**: Can't run code to verify. "Trust me" approach for code generation.

**Design**:
- Integrated sandbox for Python/JavaScript execution
- Stateful REPL environment (preserves state between calls)
- Pre-loaded libraries: numpy, pandas, matplotlib, scipy (Python); Node built-ins (JS)
- No internet access in sandbox (security)
- Results displayed inline

**Grok insight**: Stateful REPL with extensive STEM libraries (numpy, scipy, sympy, torch, rdkit, etc.). "Previous code execution result is preserved."

**Implementation**:
- Use Docker or wasmtime for sandboxing
- Add `code_execution` tool
- Pre-warm sandbox on session start
- State management across calls
- `/run <code>` slash command

---

### 4.2 Research Mode (Inspired by: Perplexity Deep Research, Anthropic suggest_research)

**Problem**: Deep investigation tasks require dozens of searches. Manual one-by-one is slow.

**Design**:
```
/research <topic>    → Autonomous research workflow
  1. Plan search strategy (5-20 searches)
  2. Execute searches in parallel batches
  3. Cross-reference findings
  4. Synthesize into structured report
  5. Present with citations
```

**Perplexity insight**: 10,000+ word comprehensive reports. Scientific report structure. Academic prose. Mandatory inline citations.

**Anthropic insight**: `suggest_research` tool — autonomous background workflow that searches many sources, cross-references, compiles detailed report.

**Implementation**:
- Add `ResearchEngine` in `src/services/research/`
- Parallel web search with result deduplication
- Report template engine
- Citation tracking
- Progress events during research
- `/research` command to initiate

---

### 4.3 Visualizer: Inline Diagrams & Charts (Inspired by: Anthropic Visualizer, Gemini Immersive Documents)

**Problem**: Architecture, flow, and data concepts are hard to convey in text.

**Design**:
- Inline SVG generation for diagrams (flowcharts, architecture, state machines)
- Chart generation for data visualization
- Interactive HTML widgets for exploration
- Render in supported terminals (Kitty, iTerm2 with image protocol)

**Anthropic insight**: "Visualizer streams inline SVG diagrams, illustrations, and HTML interactive widgets into the conversation — not files." MCP-first routing: check connected MCP tools before Visualizer.

**Gemini insight**: Canvas/Immersive Document system with thought/python/tool_code blocks. Two response types: Chat vs Canvas.

**Implementation**:
- Add `Visualizer` in `src/services/visualizer/`
- SVG generation via template system
- Chart generation via ASCII or terminal image protocols
- `/diagram <description>` command
- `/chart <data>` command

---

### 4.4 Smart Compact with Tool Result Truncation (Already partially implemented, push further)

**Current state**: Hard compact with deterministic tool truncation.

**Next level** (inspired by all products' context management):
- **Progressive summarization**: Don't just truncate — summarize tool results with decreasing detail
- **Semantic compression**: Keep code structure, compress prose
- **Checkpoint-resume**: Save full conversation state, compact, but allow `/resume` to reload from checkpoint
- **Cross-session learning**: Extract patterns from compacted sessions into memory files

**Implementation**:
- Enhance `src/services/compact/` with progressive summarization
- Add checkpoint files in `~/.fusion-code/checkpoints/`
- `/checkpoint` command to save current state
- `/resume <id>` command to restore

---

### 4.5 Collaborative Multi-Agent (Inspired by: Manus Planner+Executor, Devin multi-step, Windsurf AI Flow)

**Problem**: Single agent can't handle complex multi-step tasks efficiently.

**Design**:
```
/agent spawn <role>     → Spawn a sub-agent with specific role
  Roles: researcher, coder, reviewer, tester, deployer

/agent list             → List active agents
/agent assign <task>    → Assign task to specific agent
/agent merge            → Merge agent outputs back to main
```

**Manus insight**: Planner module (task planning), Executor module (implementation), Knowledge module (context), Datasource module (data). Typed events flowing between modules.

**Windsurf insight**: "Independent + collaborative paradigm." Agents can work independently but share context.

**Implementation**:
- Add `AgentOrchestrator` in `src/services/agents/`
- Each agent is a QueryEngine instance with scoped tools
- Shared context via memory files
- Event stream for inter-agent communication
- Background execution with progress reporting

---

## P5: Developer Experience — Polish That Matters

### 5.1 Smart Onboarding (Inspired by: Same Dev startup, Lovable non-technical focus)

**Problem**: New users don't know what Fusion-Code can do.

**Design**:
- First-run experience: detect project type, suggest relevant features
- `/tour` command: interactive feature walkthrough
- Context-aware hints: "This project uses React — try /component to scaffold"
- Progressive disclosure: show basic features first, advanced on demand

---

### 5.2 Framework-Aware Scaffolding (Inspired by: Same Dev framework templates, v0 Code Project, Replit detection)

**Problem**: Generic code generation doesn't follow project conventions.

**Design**:
- Auto-detect framework from project files (package.json, Cargo.toml, etc.)
- Framework-specific templates and patterns
- `/scaffold <type>` command with framework-aware defaults
- Example: `/scaffold api-endpoint` → Express route in Node project, Axum handler in Rust

**Same Dev insight**: `startup` tool with framework templates (nextjs-shadcn, react-vite, vue-vite, html-ts-css). Auto-configured with TypeScript, Biome, Bun.

---

### 5.3 Integration Marketplace (Inspired by: Anthropic MCP App Suggestions, v0 AddIntegration)

**Problem**: Discovering and configuring MCP servers, plugins, and integrations is manual.

**Design**:
```
/integrations              → Browse available integrations
/integrations add <name>   → Install and configure
/integrations search <q>   → Search by capability
```

**Anthropic insight**: `search_mcp_registry` → `suggest_connectors` flow. Connector directory first. Third-party tools need opt-in. Urgency is not an exception.

**v0 insight**: `AddIntegration` component with categories (database, AI). `AddEnvironmentVariables` component.

---

## Implementation Priority Matrix

| Phase | Feature | Impact | Effort | Dependencies |
|-------|---------|--------|--------|-------------|
| P0.1 | Multi-Tier Model Router | ⭐⭐⭐⭐⭐ | 🔨🔨🔨 | None |
| P0.2 | Structured Memory V2 | ⭐⭐⭐⭐⭐ | 🔨🔨🔨 | None |
| P0.3 | AGENTS.md Cascading | ⭐⭐⭐⭐ | 🔨🔨 | None |
| P0.4 | Planning Mode Toggle | ⭐⭐⭐⭐⭐ | 🔨🔨 | None |
| P1.1 | Search-First Intelligence | ⭐⭐⭐⭐ | 🔨🔨🔨 | Web tools |
| P1.2 | Tool Discovery | ⭐⭐⭐ | 🔨🔨🔨 | Tool registry refactor |
| P1.3 | Conversation Search | ⭐⭐⭐⭐ | 🔨🔨 | SQLite/FTS |
| P1.4 | Adaptive Response Style | ⭐⭐⭐ | 🔨🔨 | Memory V2 |
| P2.1 | Live Preview Integration | ⭐⭐⭐⭐ | 🔨🔨🔨🔨 | Terminal protocol |
| P2.2 | One-Command Deploy | ⭐⭐⭐ | 🔨🔨🔨 | Platform adapters |
| P2.3 | Suggested Actions | ⭐⭐⭐⭐ | 🔨🔨 | REPL integration |
| P2.4 | Event Stream | ⭐⭐⭐⭐ | 🔨🔨🔨 | Core refactor |
| P3.1 | Runtime Reminders | ⭐⭐⭐ | 🔨🔨 | None |
| P3.2 | Copyright-Aware Code | ⭐⭐⭐ | 🔨🔨🔨 | License DB |
| P3.3 | Privacy-First Memory | ⭐⭐⭐⭐ | 🔨🔨 | Memory V2 |
| P4.1 | Code Execution Sandbox | ⭐⭐⭐⭐⭐ | 🔨🔨🔨🔨🔨 | Docker/Wasm |
| P4.2 | Research Mode | ⭐⭐⭐⭐ | 🔨🔨🔨🔨 | Search-First |
| P4.3 | Visualizer | ⭐⭐⭐ | 🔨🔨🔨🔨 | Terminal protocol |
| P4.4 | Smart Compact V2 | ⭐⭐⭐⭐ | 🔨🔨 | Existing compact |
| P4.5 | Multi-Agent | ⭐⭐⭐⭐⭐ | 🔨🔨🔨🔨🔨 | Event Stream |
| P5.1 | Smart Onboarding | ⭐⭐⭐ | 🔨🔨 | None |
| P5.2 | Framework Scaffolding | ⭐⭐⭐ | 🔨🔨 | Detection engine |
| P5.3 | Integration Marketplace | ⭐⭐⭐⭐ | 🔨🔨🔨 | MCP registry |

---

## Competitive Positioning

**What makes Fusion-Code unique vs each competitor**:

| Competitor | Their Strength | Our Counter |
|-----------|---------------|-------------|
| Claude Code | Best-in-class model, memory, skills | Local MLX (free, private, offline) + multi-tier routing |
| Cursor | IDE integration, dual-model edit | CLI-first (more flexible) + MLX fallback + plugin system |
| Devin | Planning mode, autonomous execution | Planning mode + local model + human-in-the-loop |
| Windsurf | AI Flow, cascade, deploy | Same capabilities + local MLX + no API key needed |
| Bolt | WebContainer, instant preview | Local runtime (more powerful) + any language |
| v0 | QuickEdit, Code Project, AI SDK | Full CLI power + any framework + local model |
| Grok | Real-time web + X integration | Local MLX + privacy + no API key needed |
| Same/Lovable | Live preview, non-technical UX | CLI power user focus + framework agnostic |
| Droid | Strict phase system, git-first | Adapt the discipline without the rigidity |

**The killer combo**: Multi-tier model routing + structured memory + local MLX = **a coding assistant that's free, private, offline-capable, and gets smarter over time**. No other product has all four.

---

## Key Insights from CL4R1T4S Analysis

### Anthropic's Deepest Patterns
1. **Memory is a filesystem, not a database** — simple, versioned, path-structured. Enables search without complex infrastructure.
2. **Tool discovery is deferred by design** — don't pollute context with tools the user won't use this session.
3. **Skills are mandatory pre-reads** — environment-specific constraints can't be in training data.
4. **Search-before-answering is a principle, not a feature** — confidence doesn't excuse staleness.
5. **Copyright compliance is non-negotiable infrastructure** — not an afterthought.
6. **Conversation search bridges sessions** — people write as if you share their history.
7. **The Visualizer has a routing chain** — MCP-first → file request → Visualizer fallback.

### Cursor's Key Innovation
- **Dual-model edit is the right architecture** — cheap model for mechanical work, smart model for judgment calls. This is how humans work too (junior does the typing, senior reviews).

### Devin's Discipline
- **Three modes enforce thinking** — planning/standard/edit prevents jumping to code. The `think` tool is mandatory at decision points.
- **`block_on_user_response`** — not every step needs human input, but critical ones must block.

### Manus's Architecture
- **Event stream as backbone** — everything flows through typed events. Enables observability, replay, and multi-agent coordination.
- **Planner as separate module** — planning is a first-class capability, not just a longer system prompt.

### Meta's Personality System
- **"Simplification without request is condescension"** — respect the user's intelligence by default.
- **Writing style rules** — no stock phrases, varied sentence structure, natural language. These matter for trust.

### Factory Droid's Rigor
- **Git sync + frozen install before any code change** — prevents "works on my machine" and merge conflicts.
- **Phase 0 intent gate on EVERY message** — re-evaluate whether you're in implementation or diagnostic mode.

### Grok's Tool Integration
- **Stateful code execution REPL** — preserve state between calls. Makes Python execution actually useful.
- **X ecosystem search** — domain-specific tools (keyword, semantic, user, thread) for a specific platform.

### v0's UX Polish
- **QuickEdit for small changes** — don't over-engineer small modifications. 1-20 lines, 1-3 steps.
- **Suggested Actions after every response** — maintain momentum. The user should never have to think "what next?"

---

## Implementation Order (Recommended)

```
Batch 1 (Foundation — 2-3 weeks):
  P0.4 Planning Mode Toggle
  P0.3 AGENTS.md Cascading
  P1.4 Adaptive Response Style
  P3.1 Runtime Reminders

Batch 2 (Memory & Intelligence — 2-3 weeks):
  P0.2 Structured Memory V2
  P1.3 Conversation Search
  P1.2 Tool Discovery
  P3.3 Privacy-First Memory

Batch 3 (Routing & Search — 2-3 weeks):
  P0.1 Multi-Tier Model Router
  P1.1 Search-First Intelligence
  P2.3 Suggested Actions

Batch 4 (Workflow — 3-4 weeks):
  P2.4 Event Stream
  P2.1 Live Preview Integration
  P2.2 One-Command Deploy
  P5.2 Framework Scaffolding

Batch 5 (Advanced — 4-6 weeks):
  P4.4 Smart Compact V2
  P4.2 Research Mode
  P4.1 Code Execution Sandbox

Batch 6 (Frontier — 6-8 weeks):
  P4.3 Visualizer
  P4.5 Multi-Agent
  P5.1 Smart Onboarding
  P5.3 Integration Marketplace
  P3.2 Copyright-Aware Code
```

---

*Document generated from analysis of 25+ AI system prompts (CL4R1T4S) and 4 open source coding tools. Last updated: 2026-07-25.*
