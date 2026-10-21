# Graph Report - DropHall  (2026-10-21)

## Corpus Check
- 29 files · ~45,065 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: .glb 6, (none) 4, .css 1)

## Summary
- 197 nodes · 330 edges · 16 communities (9 shown, 7 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3b415450`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- museum.js
- World
- Directory rendering
- DropHall plan
- DropHall: instructions for Cursor
- .cf-https.js
- .claude/CLAUDE.md
- mcp.json
- Walker
- BladeField
- blade.js
- World.js
- Temporal
- BladeField.js

## God Nodes (most connected - your core abstractions)
1. `BladeField` - 22 edges
2. `Walker` - 19 edges
3. `World` - 14 edges
4. `ShadowMapper` - 10 edges
5. `Temporal` - 9 edges
6. `TextureBaker` - 9 edges
7. `DropHall plan` - 8 edges
8. `FieldSampler` - 7 edges
9. `GLSL_MATH` - 5 edges
10. `GLSL_HASH` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Add an exhibit` --references--> `room()`  [INFERRED]
  README.md → js/museum.js
- `Add an exhibit` --references--> `frame()`  [INFERRED]
  README.md → js/museum.js

## Import Cycles
- None detected.

## Communities (16 total, 7 thin omitted)

### Community 0 - "museum.js"
Cohesion: 0.11
Nodes (15): createFluffyLawn(), onLawn(), QUALITY, resolveSpecies(), ringBudget(), ringExtent(), SCENES, frame() (+7 more)

### Community 1 - "World"
Cohesion: 0.10
Nodes (4): ShadowMapper, World, TextureBaker, FieldSampler

### Community 3 - "DropHall plan"
Cohesion: 0.22
Nodes (8): Decided, Done log, DropHall plan, Not decided yet, Now: Claude, Now: Cursor, Requests for Claude, Requests for Cursor

### Community 6 - "DropHall: instructions for Cursor"
Cohesion: 0.40
Nodes (4): DropHall: instructions for Cursor, How the site works, Rules, Who owns what

### Community 10 - "Walker"
Cohesion: 0.13
Nodes (6): slideAlongSlope(), slopeRiseWalkable(), verticalLookDelta(), walkableGroundDrop(), Walker, WALKER_DEFAULTS

### Community 12 - "blade.js"
Cohesion: 0.26
Nodes (14): GLSL_FIELD, GLSL_COMMON, GLSL_HASH, GLSL_MATH, GLSL_NOISE_RT, GLSL_BRDF, GLSL_DITHER, GLSL_FOG (+6 more)

### Community 13 - "World.js"
Cohesion: 0.19
Nodes (12): BLADE_A_FRAG, BLADE_B_FRAG, FIELD_FRAG, GROUND_A_FRAG, GROUND_B_FRAG, NOISE_ATLAS_FRAG, QUAD_VERT, GLSL_NOISE_BAKE (+4 more)

### Community 14 - "Temporal"
Cohesion: 0.19
Nodes (5): halton(), Temporal, FS_QUAD_VERT, TAA_OUTPUT_FRAG, TAA_RESOLVE_FRAG

### Community 15 - "BladeField.js"
Cohesion: 0.20
Nodes (9): DEFAULTS, lin(), packSpecies(), SHRUBS, SPECIES, BLADE_DEPTH_FRAG, BLADE_FRAG, BLADE_VERT (+1 more)

## Knowledge Gaps
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `BladeField` connect `BladeField` to `BladeField.js`?**
  _High betweenness centrality (0.159) - this node is a cross-community bridge._
- **Should `museum.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10666666666666667 - nodes in this community are weakly interconnected._
- **Why does `World` connect `World` to `museum.js`, `World.js`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Should `World` be split into smaller, more focused modules?**
  _Cohesion score 0.10227272727272728 - nodes in this community are weakly interconnected._
- **Should `Walker` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._
- **Should `BladeField` be split into smaller, more focused modules?**
  _Cohesion score 0.1067193675889328 - nodes in this community are weakly interconnected._