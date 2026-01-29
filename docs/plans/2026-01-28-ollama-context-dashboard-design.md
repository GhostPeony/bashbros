# Ollama Integration, Shared Context Store & Dashboard Expansion

**Date:** 2026-01-28
**Status:** Approved

## Overview

Three interconnected features that expand BashBros into a full Ollama control plane, add AI-powered intelligence to the router and suggester, and introduce a shared file-based context store accessible by all CLI agents.

---

## Section 1: Ollama Model & Adapter Management

Three layers of model management on the dashboard.

### Layer 1 - Base Models (Ollama catalog)

New `OllamaClient` methods wrapping Ollama's HTTP API:

- `pullModel(name, onProgress)` - Download models with streaming progress callbacks (`POST /api/pull`)
- `deleteModel(name)` - Remove models (`DELETE /api/delete`)
- `showModel(name)` - Full model info: parameter count, quantization level, template, license, family (`POST /api/show`)
- `listRunning()` - Currently loaded models with VRAM/RAM usage (`GET /api/ps`)

New dashboard endpoints:

- `POST /api/bro/models/pull` - Start a model pull (streams progress via WebSocket)
- `DELETE /api/bro/models/:name` - Delete a model
- `GET /api/bro/models/:name` - Get model details
- `GET /api/bro/models/running` - Show loaded models + memory usage

Dashboard UI:

- Model cards showing name, size, quantization (Q4_K_M, etc.), family, parameter count, last modified
- Pull bar - type a model name (e.g., `deepseek-coder:6.7b`), hit pull, see a progress bar via WebSocket
- Active model indicator with memory usage (VRAM/RAM split)
- Delete button per model with confirmation
- Quick-switch - click any installed model to make it active

### Layer 2 - LoRA Adapters (BashGym pipeline)

BashBros discovers GGUF LoRA adapters from `~/.bashgym/integration/models/adapters/` and manages them:

- **Adapter registry** - Each adapter has a manifest entry: name, base model it targets, training date, trace count used, quality score, purpose tag (e.g., `command-suggest`, `safety-analysis`, `routing`)
- **Adapter to Ollama model creation** - BashBros auto-generates Ollama `Modelfile`s that combine a base model + adapter, then calls `ollama create` to register them as usable models. e.g., base `qwen2.5-coder:7b` + adapter `bashgym-suggest-v3` = Ollama model `bashbros/suggest:v3`
- **Quick-swap** - Switch the active adapter from the dashboard without restarting. BashBros writes a new Modelfile and calls `ollama create` to rebuild

### Layer 3 - Composite Profiles

A "profile" combines a base model + adapter + purpose. Example: the "Balanced" profile uses `qwen2.5-coder:7b` + `suggest-v5` for suggestions and `safety-v2` for analysis. Profiles are stored as JSON in `.bashbros/models/profiles/`.

---

## Section 2: Smarter AI Features

### AI-Enhanced Router

The pattern-based router stays as the fast path. When a command doesn't match any pattern (the "ambiguous" case), the router calls Ollama to classify it:

- Input: the command + recent context (last 3 commands, project type, current directory)
- Output: `bro` | `main` | `both` with confidence score
- Fallback: if Ollama is down or slow (>2s), default to `main` (safe fallback)
- Learning: routed decisions get logged to the context store so the router improves over time

### AI-Enhanced Suggester

Same hybrid approach. Pattern-based suggestions fire first. Then Ollama generates additional suggestions ranked by relevance:

- Considers: last N commands, current errors, project type from the system profiler, what files were recently modified
- Returns 1-3 additional suggestions the pattern matcher wouldn't catch
- Cached: identical contexts return cached suggestions (TTL 5 minutes)

### Per-Function Adapter Routing

Different BashBro functions can use different adapters:

- `suggest` - adapter trained on successful command sequences
- `safety` - adapter trained on security violations
- `route` - adapter trained on routing decisions
- `explain` / `fix` / `script` - base model (general purpose)

The `OllamaClient` gets a `generateWithAdapter(purpose, prompt)` method that looks up which model/adapter to use for that purpose from the active profile.

---

## Section 3: Shared Context Store

File-based system at `.bashbros/context/` in the project root (per-project, not home directory).

### Directory Structure

```
.bashbros/context/
├── memory/                     # Persistent project knowledge (human + agent readable)
│   ├── decisions.md            # Architectural decisions made during sessions
│   ├── conventions.md          # Coding patterns, naming, style choices
│   ├── issues.md               # Known issues, gotchas, workarounds
│   └── custom/                 # User-created memory files
│
├── artifacts/                  # Structured session data (machine readable)
│   ├── sessions/               # One JSON per session
│   │   └── {timestamp}-{agent}-{id}.json
│   ├── commands/               # Command history with outputs
│   │   └── {date}.jsonl        # Append-only, one entry per line
│   └── errors/                 # Error logs with resolution status
│       └── {date}.jsonl
│
└── index.json                  # Manifest: last updated, agent list, file counts
```

### Behavior

- **BashBros writes automatically.** After each session, it appends to `commands/`, logs errors to `errors/`, and creates a session summary in `sessions/`. The memory files (`decisions.md`, etc.) get updated when the AI sidekick detects a meaningful decision or convention in the session trace.
- **Any agent reads naturally.** Claude Code reads `decisions.md` like it reads `CLAUDE.md`. Copilot, Gemini, etc. can do the same - they're just markdown files. No special integration needed.
- **Retention policy.** Artifacts older than 30 days get pruned automatically (configurable). Memory files are permanent.
- **`.gitignore`-friendly.** Artifacts are gitignored by default. Memory files are optionally committed (user choice).

---

## Section 4: Dashboard Integration

### "Models" Tab (new)

- **Installed Models** - Card grid showing each Ollama model with: name, parameter count, quantization, size on disk, family. Pull button with progress bar, delete with confirmation.
- **Running Models** - Which models are loaded in memory, VRAM/RAM usage per model (from `GET /api/ps`)
- **Adapters** - Cards for each BashGym LoRA adapter: name, base model, purpose tag, quality score, trace count, training date. "Activate" button that creates the Ollama model and switches to it.
- **Profiles** - Editor to assign adapters to functions (suggest, safety, route, explain, fix). Save/load named profiles.

### "Bash Bro" Tab (updated)

- **Status panel** - Ollama connection, active model, active profile, active adapters per function
- **Activity log** - Same as current but enriched: shows which adapter handled each request, latency, cache hit/miss
- **Router stats** - Pattern-matched vs AI-routed decisions, confidence distribution
- **Suggestion stats** - Pattern vs AI suggestions, acceptance rate if tracked

### "Context" Tab (new)

- **Memory viewer** - Read/edit the markdown memory files inline
- **Session browser** - Search and filter past session artifacts by agent, date, command
- **Error log** - Recent errors with resolution status
- **Stats** - Total sessions, commands logged, agents seen, store size on disk

### New WebSocket Events

- `model:pull:progress` - Streaming download progress
- `adapter:activated` - Adapter switch notification
- `context:updated` - Memory file changed
