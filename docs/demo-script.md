# Demo video script

Two minutes, four beats, one camera setup: screen recording of a real Google
Meet call with the Counterpoint sidebar open in the corner. No cutaways to
slides. The panel's state chip (`listening` / `holding` / `opening` /
`speaking`) and its reason text are the evidence — keep them in frame and in
focus for every beat.

State names and reason codes below match `shared/src/turn-taking-gate.ts`
(`GatePhase`, `SuppressionReason`) so whoever builds the sidebar can wire the
on-screen copy directly to real gate output instead of inventing new labels.

Total runtime: **110s** (10s of headroom under the 120s limit).

## Cast

- **A** and **B** — two teammates in a real Meet call, having a normal
  brainstorm. Neither one looks at or talks to the panel at any point in the
  video. That silence is the point: the agent's proactive path never requires
  being addressed.

## Shot list

| # | Time | Beat | Visual | Line / audio | On-screen panel state |
|---|------|------|--------|---------------|------------------------|
| 1 | 0:00–0:05 | setup | Wide shot: Meet call, two faces, Counterpoint sidebar visible but quiet. | A: "Okay, so — for billing, I think we just default everyone to weekly." | Chip: `listening`. No card. |
| 2 | 0:05–0:15 | (a) question asked, detection starts, nobody addresses the agent | Same shot continues. B answers, panel changes on its own in the corner while both keep facing each other, not the screen. | B: "Yeah, weekly feels safer than monthly for us." | Chip flips `listening` → `holding`. A card fades in: *"Checking churn/support data on billing-cycle length…"* — small, no sound, no highlight drawing attention to it. |
| 3 | 0:15–0:30 | (a) cont'd, research running in the background | A and B move on to a sub-point, still not looking at the panel. | A: "And support already has enough tickets as it is." | Chip stays `holding`. Card spinner still present. Push in slightly on the sidebar so the viewer, not the actors, notices it. |
| 4 | 0:30–0:45 | (b) finding arrives and is held | Cut to a closer shot of just the sidebar. Conversation audio continues underneath, slightly ducked. | (B, off-panel, continuing): "...so let's just lock it in and move to onboarding." | Card fills in: *"Found: weekly billing shows higher support-ticket volume than monthly in 2 sources."* Chip stays `holding` with visible reason text: **"Holding — waiting for a real pause, not mid‑sentence."** The finding is plainly ready but not shown to the room yet. |
| 5 | 0:45–0:55 | (c) pause, agent offers it | A and B actually stop talking — a real conversational gap. | *(silence, ~1s, visible on both faces — this is the "opening")* | Chip: `holding` → `opening` → `speaking`, in view, fast. |
| 6 | 0:55–1:15 | (c) cont'd | Same shot; agent's voice plays over the sidebar, captioned live in the card. | **Agent (voice):** "Quick note — weekly billing cycles ran about 18% more support tickets than monthly in the two studies Exa found. If ticket load is the real constraint, monthly may be the safer default." | Chip: `speaking`. Card shows the two source citations (domains, not just "Exa says") under the caption. |
| 7 | 1:15–1:20 | transition | A nods, says one line acknowledging it without over-selling the moment. | A: "Huh — okay, let's flag that for finance." | Chip `speaking` → `listening`. |
| 8 | 1:20–1:40 | (d) topic moves on, a prepared finding is discarded — **do not cut this beat** | Wide shot again, both people now fully on a new topic. Mid-conversation, a *second* candidate had already been forming (started during shot 3–4, off-screen) about something in the onboarding discussion. | A: "Let's park billing — what about the onboarding checklist?" B: "Right, I think we can drop the email-verification step." | Chip briefly shows `holding` on the second, unrelated card, then the card visibly greys out / gets struck through. **Reason text stays on screen for at least 3 full seconds:** "Discarded — the conversation moved on before an opening arrived." (internally `suppress_candidate`, `reason: candidate_expired`) |
| 9 | 1:40–1:50 | (d) cont'd, the tell | Slow push into the greyed-out card so the viewer reads the reason, not just glimpses it. No narration — let it sit in silence. | *(no dialogue — hold on the discarded card)* | Chip settles to `listening`. Discarded card remains visible, struck through, until cut. |

**Total: 110s.**

## Why beat (d) is not optional

Beats (a)–(c) prove the agent can find and time a good interjection. Beat (d)
proves the opposite half of the pitch: the agent also knows when *not* to
speak, and it says so visibly instead of silently dropping the thought or
blurting it late. A viewer who only sees (a)–(c) will assume this is just a
research bot with good timing; (d) is the shot that shows restraint is a
designed behavior, not an accident. If time runs short elsewhere, cut shot 3
or compress shot 7 — never (d), and never drop the on-screen reason text in
(d) to save a second.

## Capture notes

- Record the actual sidebar UI once it exists; do not fake the panel copy in
  post — the reason strings above should come from real `Decision`/`GateAction`
  values so the demo can't drift from what the gate actually does.
- Keep both faces and the panel in the same frame throughout beats (a)–(d) so
  it's visually obvious nobody cues the agent by looking at it or talking to
  it.
- No music under shots 8–9; the silence around the discarded card is part of
  the point.
