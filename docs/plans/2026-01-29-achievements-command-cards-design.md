# Achievements Page & Command Cards Redesign

**Date:** 2026-01-29
**Status:** Approved

## Overview

Two connected changes to the BashBros dashboard:

1. **Achievements Page** -- A new "Achievements" tab with player profile, big-number stats, XP/rank system, and a tiered badge wall. All stats are local and user-specific.
2. **Command Cards** -- Redesign the live command feed from flat list rows to brutalist stamp-down cards with visual weight based on risk level.

---

## 1. Achievements Page

New nav tab positioned after Context, before Settings.

### 1.1 Player Card (Top Banner)

Full-width banner at the top of the page.

- **Username** from OS
- **Callsign** -- generated title based on stat profile (e.g., "The Gatekeeper" for heavy security blocks, "Speed Demon" for high commands/hour, "Night Owl" for late-night usage)
- **Overall Rank** -- large tier badge: Bronze / Silver / Gold / Diamond / Obsidian
- **XP Progress Bar** -- brutalist style (thick border, teal fill, hard shadow), shows current XP and distance to next rank. At Obsidian, shows uncapped total XP.
- **Compact stats row**: Member since, Total sessions, Total commands

### 1.2 Big Number Counters

Three rows of stat cards with large JetBrains Mono numbers and small labels.

**Row 1: Core Totals**
- Commands Executed (lifetime)
- Threats Blocked (lifetime violations)
- Sessions Completed
- Time Under Watch (formatted as "4d 12h 33m")
- Repos Protected (unique repositories)
- Characters Commanded (total characters across all commands)

**Row 2: Agent Breakdown**
- Per-agent cards rendered dynamically based on installed hooks
- Each agent (Claude Code, Gemini CLI, Copilot CLI, OpenCode, Moltbot) gets:
  - Agent icon/name
  - Command count from that agent
  - Percentage of total
  - Small bar showing share vs. others
- **Favorite Agent** -- highest count, highlighted with crown/star
- **Agent Diversity Score** -- e.g., "3/5 agents deployed"

**Row 3: Behavioral / Nonsensical**
- Most-Used Command (with count, e.g., "git status -- 847 times")
- Unique Commands (distinct commands ever executed)
- Longest Command (character count of longest single command)
- Peak Hour (most active hour, e.g., "You peak at 2:00 AM")
- Peak Day (most active day of week)
- Busiest Day Ever (date + count)
- Avg Commands/Session
- Longest Session (duration)
- Late Night Commands (midnight to 5 AM count)
- Risk Average (lifetime)
- Cleanest Streak (longest run without violation)
- Highest Risk Command (verbatim display of the most dangerous command ever run)

### 1.3 Badge Wall

Grid of badge cards below the stats. Each badge is a small brutalist card with an icon, name, description, and tier indicator. Locked badges are greyed out with dashed borders.

**Badge Tier Visuals:**
- **Bronze** -- grey-800 border, no shadow
- **Silver** -- grey-500 border, small shadow
- **Gold** -- yellow border, medium shadow, gold tint background
- **Diamond** -- blue border, full shadow, subtle CSS shimmer animation
- **Obsidian** -- grey-900 fill with teal border, inverted colors, full shadow

**Achievement Categories & Badges:**

#### Volume
| Badge | Tiers (Bronze / Silver / Gold / Diamond / Obsidian) |
|-------|------------------------------------------------------|
| First Blood -- Execute commands | 1 / 100 / 1,000 / 10,000 / 100,000 |
| Marathon Runner -- Complete sessions | 1 / 10 / 50 / 200 / 1,000 |
| Watchdog -- Time under watch | 1h / 24h / 7d / 30d / 365d |

#### Security
| Badge | Tiers |
|-------|-------|
| Shield Bearer -- Threats blocked | 1 / 25 / 100 / 500 / 2,000 |
| Clean Hands -- Consecutive clean commands | 10 / 50 / 200 / 1,000 / 5,000 |
| Risk Taker -- High risk commands | risk 8+ / 9+ / 10 / ten 10s / fifty 10s |

#### Agents
| Badge | Tiers |
|-------|-------|
| Buddy System -- Use 2 agents | single tier |
| Squad Up -- Use multiple agents | 3 / 4 / 5 agents |
| Loyal -- Commands from single agent | 1,000 (single tier) |
| Polyglot -- 100+ commands from N agents | 3 / 4 / 5 agents |

#### Behavioral
| Badge | Tiers |
|-------|-------|
| Night Owl -- Commands after midnight | 10 / 100 / 500 / 2,000 / 10,000 |
| Early Bird -- Commands before 6 AM | 10 / 100 / 500 / 2,000 / 10,000 |
| Speed Demon -- Commands in a single hour | 60 / 100 / 150 / 200 / 300 |
| Centurion -- Commands in a single session | 100 / 200 / 500 / 1,000 / 2,000 |
| One-Liner -- Longest command (chars) | 500 / 1,000 / 2,000 / 5,000 / 10,000 |
| Creature of Habit -- Same command repeated | 50 / 200 / 500 / 1,000 / 5,000 |
| Explorer -- Unique commands used | 25 / 50 / 100 / 250 / 500 |

#### Repo
| Badge | Tiers |
|-------|-------|
| Home Base -- Protect 1 repo | single tier |
| Empire -- Protect multiple repos | 3 / 5 / 10 / 25 / 50 |

**Total: ~15 badges, ~75 unlockables**

### 1.4 XP & Rank System

**XP Sources:**
| Action | XP |
|--------|----|
| Command executed | +1 |
| Command blocked (security worked) | +3 |
| Session completed | +10 |
| Badge unlocked (Bronze) | +50 |
| Badge unlocked (Silver) | +100 |
| Badge unlocked (Gold) | +200 |
| Badge unlocked (Diamond) | +500 |
| Badge unlocked (Obsidian) | +1,000 |
| Clean streak of 100 | +25 bonus |
| Late night command (midnight-5AM) | +2 (hazard pay) |

**Rank Tiers:**
| Rank | XP Required | Visual |
|------|------------|--------|
| Bronze | 0 | Grey-800 badge, no effects |
| Silver | 1,000 | Grey-400 badge, small shadow |
| Gold | 5,000 | Yellow badge, medium shadow |
| Diamond | 25,000 | Blue badge, shimmer animation |
| Obsidian | 100,000 | Black + teal, pulse glow animation |

---

## 2. Command Cards Redesign (Live Feed)

Replace flat list rows in the live command feed with brutalist stamp-down cards.

### Card Behavior
- Each command renders as a mini brutalist card
- **Stamp-down animation**: starts translated up 12px, scaled 1.05, no shadow. Lands at rest position with shadow snapping in. ~200ms ease-out.
- Cards stack with **-4px negative margin**, newest on top with highest z-index
- Session color stripe stays on the left edge

### Risk = Visual Weight
| Risk Level | Border | Shadow | Accent |
|-----------|--------|--------|--------|
| Safe | 2px | 3px offset | teal left-stripe |
| Caution | 3px | 4px offset | yellow left-stripe |
| Dangerous | 3px | 5px offset | orange left-stripe |
| Critical | 4px | 6px offset | red left-stripe, slight skew on entry |

### Blocked Commands
- Red "BLOCKED" stamp overlays the card using the same stamp-down keyframe
- Card receives `skewX(-1deg)` transform and muted opacity
- Stamp is a pseudo-element or overlay div with bold uppercase text, slight rotation

### What Stays the Same
- Session pills and filtering at the top
- Grid layout with violations panel on the right
- All existing metadata (risk badge, session ID, timestamp, duration)

---

## Data Storage

All achievement data is stored in the existing SQLite database (`bashbros.db`). New tables/columns needed:

- **user_stats** -- Aggregated lifetime stats (total commands, total sessions, total XP, rank, etc.)
- **achievements** -- Rows per badge with current tier and unlock timestamps
- **stat_snapshots** -- Periodic snapshots for tracking trends (optional, for future charts)

Stats are computed from existing `commands` and `sessions` tables where possible, with incremental counters for performance.

---

## Implementation Notes

- All animations are CSS-only (`@keyframes`, transitions)
- Badge shimmer effect uses CSS `background: linear-gradient()` animation
- Callsign generation is a simple rule-based function mapping stat ratios to titles
- XP is recalculated on page load from the database, not stored as a running total (keeps it consistent)
- Achievement checks run on each new command/session event via the existing WebSocket update path
