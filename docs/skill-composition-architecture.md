# Skill composition

Skills can reuse other skills without copying their Markdown.

Each skill stores an ordered `dependencies` array of skill IDs. The Skills view
labels these relationships as **Calls sub-skills**. Loading a parent skill
recursively composes enabled, non-deprecated dependencies after the parent
content and reports the resolved dependency names.

Rules:

- dependencies are ordered and de-duplicated;
- direct self-references are removed;
- circular dependency updates are rejected;
- a dependency is emitted at most once during a load;
- recursive loading is bounded to eight levels;
- deleting a skill removes its ID from parent dependency lists;
- disabled, missing, and deprecated dependencies are skipped.

This keeps focused capabilities—such as BFO layout rules, typography, record
bindings, and visual comparison heuristics—in small reusable sub-skills while a
workflow skill coordinates them.
