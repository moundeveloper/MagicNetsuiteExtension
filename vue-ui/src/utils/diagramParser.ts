/**
 * Diagram DSL parser — supports flowchart and sequence diagram types.
 * Inspired by Mermaid syntax but simplified for AI-generated diagrams.
 */

// ── Types ──────────────────────────────────────────

export type DiagramType = "flowchart" | "sequence";
export type Direction = "TD" | "TB" | "LR" | "RL" | "BT";
export type NodeShape =
  | "rect"
  | "rounded"
  | "diamond"
  | "cylinder"
  | "circle"
  | "hexagon"
  | "stadium";
export type EdgeStyle = "solid" | "dashed" | "thick";

export interface DiagramNode {
  id: string;
  label: string;
  shape: NodeShape;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  style: EdgeStyle;
  hasArrow: boolean;
}

export interface SubgraphDef {
  id: string;
  label: string;
  nodeIds: string[];
}

export interface Participant {
  id: string;
  label: string;
}

export interface SeqMessage {
  from: string;
  to: string;
  label: string;
  dashed: boolean;
}

export interface SeqNote {
  over: string[];
  text: string;
}

export interface ParsedDiagram {
  type: DiagramType;
  direction: Direction;
  nodes: Map<string, DiagramNode>;
  edges: DiagramEdge[];
  subgraphs: SubgraphDef[];
  participants: Participant[];
  messages: SeqMessage[];
  notes: SeqNote[];
}

// ── Internal helpers ───────────────────────────────

interface NodeRef {
  id: string;
  label: string;
  shape: NodeShape;
  consumed: number;
}

interface EdgeRef {
  style: EdgeStyle;
  label?: string;
  hasArrow: boolean;
  consumed: number;
}

/**
 * Attempt to parse a node reference at the start of `text`.
 * Shapes are determined by the bracket pattern after the ID:
 *   [text]   → rect        (text)   → rounded
 *   {text}   → diamond     [(text)] → cylinder
 *   ((text)) → circle      {{text}} → hexagon
 *   ([text]) → stadium
 * A bare ID with no brackets defaults to rect.
 */
const tryParseNodeRef = (text: string): NodeRef | null => {
  const idMatch = text.match(/^([a-zA-Z_]\w*)/);
  if (!idMatch) return null;
  const id = idMatch[1]!;
  const after = text.slice(id.length);

  const shapes: Array<{ open: string; close: string; shape: NodeShape }> = [
    { open: "{{", close: "}}", shape: "hexagon" },
    { open: "((", close: "))", shape: "circle" },
    { open: "[(", close: ")]", shape: "cylinder" },
    { open: "([", close: "])", shape: "stadium" },
    { open: "[", close: "]", shape: "rect" },
    { open: "(", close: ")", shape: "rounded" },
    { open: "{", close: "}", shape: "diamond" },
  ];

  for (const { open, close, shape } of shapes) {
    if (after.startsWith(open)) {
      const inner = after.slice(open.length);
      const closeIdx = inner.indexOf(close);
      if (closeIdx !== -1) {
        const label = inner
          .slice(0, closeIdx)
          .trim()
          .replace(/^["']|["']$/g, "")
          .replace(/<br\s*\/?>/gi, "\n");
        return {
          id,
          label: label || id,
          shape,
          consumed: id.length + open.length + closeIdx + close.length,
        };
      }
    }
  }

  // Bare ID — no shape brackets
  return { id, label: id, shape: "rect", consumed: id.length };
};

/**
 * Attempt to parse an edge arrow at the start of `text`.
 * Supports solid (-->), dashed (-.->), thick (==>), with optional labels.
 * Label syntax: -->|label text|
 */
const tryParseEdge = (text: string): EdgeRef | null => {
  const patterns: Array<{ re: RegExp; style: EdgeStyle; arrow: boolean }> = [
    // Labeled arrows (must be checked before unlabeled)
    { re: /^={2,}>\|([^|]*)\|/, style: "thick", arrow: true },
    { re: /^-\.+->\|([^|]*)\|/, style: "dashed", arrow: true },
    { re: /^-{2,}>\|([^|]*)\|/, style: "solid", arrow: true },
    // Unlabeled arrows
    { re: /^={2,}>/, style: "thick", arrow: true },
    { re: /^-\.+->/, style: "dashed", arrow: true },
    { re: /^-{2,}>/, style: "solid", arrow: true },
    // No-arrow connectors
    { re: /^-\.+-/, style: "dashed", arrow: false },
    { re: /^-{3,}/, style: "solid", arrow: false },
    { re: /^={3,}/, style: "thick", arrow: false },
  ];

  for (const { re, style, arrow } of patterns) {
    const m = text.match(re);
    if (m) {
      return {
        style,
        label: m[1]?.trim() || undefined,
        hasArrow: arrow,
        consumed: m[0].length,
      };
    }
  }
  return null;
};

/**
 * Register (or update) a node in the nodes map.
 * Updates label/shape only if the reference provides an explicit label
 * (different from the bare ID).
 */
const registerNode = (nodes: Map<string, DiagramNode>, ref: NodeRef) => {
  if (!nodes.has(ref.id)) {
    nodes.set(ref.id, { id: ref.id, label: ref.label, shape: ref.shape });
  } else if (ref.label !== ref.id) {
    const existing = nodes.get(ref.id)!;
    existing.label = ref.label;
    existing.shape = ref.shape;
  }
};

// ── Flowchart parsing ──────────────────────────────

/**
 * Parse a single flowchart line that may contain chained connections:
 *   A[Label] --> B{Decision?} --> C(End)
 */
const parseFlowchartLine = (
  line: string,
  nodes: Map<string, DiagramNode>,
  edges: DiagramEdge[]
): string[] => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("%%")) return [];

  let pos = 0;
  const referencedIds: string[] = [];

  const first = tryParseNodeRef(trimmed);
  if (!first) return [];
  pos = first.consumed;
  registerNode(nodes, first);
  referencedIds.push(first.id);

  let prev = first;

  while (pos < trimmed.length) {
    // Skip whitespace
    const ws = trimmed.slice(pos).match(/^\s+/);
    if (ws) pos += ws[0].length;
    if (pos >= trimmed.length) break;

    // Try to parse an edge
    const edge = tryParseEdge(trimmed.slice(pos));
    if (!edge) break;
    pos += edge.consumed;

    // Skip whitespace after edge
    const ws2 = trimmed.slice(pos).match(/^\s+/);
    if (ws2) pos += ws2[0].length;

    // Parse next node
    const next = tryParseNodeRef(trimmed.slice(pos));
    if (!next) break;
    pos += next.consumed;
    registerNode(nodes, next);
    referencedIds.push(next.id);

    edges.push({
      from: prev.id,
      to: next.id,
      label: edge.label,
      style: edge.style,
      hasArrow: edge.hasArrow,
    });

    prev = next;
  }

  return referencedIds;
};

/**
 * Parse all flowchart lines including subgraph blocks.
 */
const parseFlowchart = (
  lines: string[],
  direction: Direction
): ParsedDiagram => {
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const subgraphs: SubgraphDef[] = [];
  let currentSubgraph: SubgraphDef | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;

    // Subgraph start:  subgraph id ["Label"]
    const sgMatch = trimmed.match(
      /^subgraph\s+(\w+)\s*(?:\[["']?(.+?)["']?\])?\s*$/i
    );
    if (sgMatch) {
      currentSubgraph = {
        id: sgMatch[1]!,
        label: sgMatch[2] || sgMatch[1]!,
        nodeIds: [],
      };
      continue;
    }

    // Subgraph end
    if (trimmed.toLowerCase() === "end" && currentSubgraph) {
      subgraphs.push(currentSubgraph);
      currentSubgraph = null;
      continue;
    }

    // Normal flowchart line
    const referencedIds = parseFlowchartLine(trimmed, nodes, edges);

    // Track node IDs inside current subgraph
    if (currentSubgraph) {
      for (const nid of referencedIds) {
        if (!currentSubgraph.nodeIds.includes(nid)) {
          currentSubgraph.nodeIds.push(nid);
        }
      }
    }
  }

  // Close any unclosed subgraph
  if (currentSubgraph) {
    subgraphs.push(currentSubgraph);
  }

  return {
    type: "flowchart",
    direction,
    nodes,
    edges,
    subgraphs,
    participants: [],
    messages: [],
    notes: [],
  };
};

// ── Sequence parsing ───────────────────────────────

const parseSequence = (lines: string[]): ParsedDiagram => {
  const participants: Participant[] = [];
  const messages: SeqMessage[] = [];
  const notes: SeqNote[] = [];
  const seenIds = new Set<string>();

  /** Ensure a participant exists (auto-created from message references). */
  const ensureParticipant = (id: string) => {
    if (!seenIds.has(id)) {
      seenIds.add(id);
      participants.push({ id, label: id });
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;

    // participant <id> as <label>
    const partMatch = trimmed.match(
      /^participant\s+(\w+)\s+as\s+(.+)$/i
    );
    if (partMatch) {
      const id = partMatch[1]!;
      const label = partMatch[2]!.trim().replace(/^["']|["']$/g, "");
      if (!seenIds.has(id)) {
        seenIds.add(id);
        participants.push({ id, label });
      } else {
        // Update label for already-seen participant
        const p = participants.find((pp) => pp.id === id);
        if (p) p.label = label;
      }
      continue;
    }

    // participant <id>  (no alias)
    const partSimple = trimmed.match(/^participant\s+(\w+)\s*$/i);
    if (partSimple) {
      ensureParticipant(partSimple[1]!);
      continue;
    }

    // note over A,B: text  |  note over A: text  |  note left of A: text
    const noteMatch = trimmed.match(
      /^note\s+(?:over|left\s+of|right\s+of)\s+([\w,\s]+)\s*:\s*(.+)$/i
    );
    if (noteMatch) {
      const over = noteMatch[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      notes.push({ over, text: noteMatch[2]!.trim() });
      continue;
    }

    // Message: A ->> B: label  |  A -->> B: label  |  A -> B: label  |  A --> B: label
    const msgMatch = trimmed.match(
      /^(\w+)\s+(-{1,2}>{1,2})\s+(\w+)\s*:\s*(.+)$/
    );
    if (msgMatch) {
      const from = msgMatch[1]!;
      const arrow = msgMatch[2]!;
      const to = msgMatch[3]!;
      const label = msgMatch[4]!.trim();
      const dashed = arrow.startsWith("--");

      ensureParticipant(from);
      ensureParticipant(to);

      messages.push({ from, to, label, dashed });
      continue;
    }
  }

  return {
    type: "sequence",
    direction: "TD",
    nodes: new Map(),
    edges: [],
    subgraphs: [],
    participants,
    messages,
    notes,
  };
};

// ── Main entry point ───────────────────────────────

/**
 * Parse a diagram DSL source string into a structured representation.
 * The first line determines the diagram type and direction:
 *   flowchart TD      sequence
 *   graph LR          (graph is alias for flowchart)
 */
export const parseDiagram = (source: string): ParsedDiagram => {
  const lines = source.split("\n");
  const firstLine = (lines[0] || "").trim().toLowerCase();
  const rest = lines.slice(1);

  // Sequence diagram
  if (firstLine === "sequence") {
    return parseSequence(rest);
  }

  // Flowchart / graph
  const fcMatch = firstLine.match(/^(?:flowchart|graph)\s*(td|tb|lr|rl|bt)?$/i);
  if (fcMatch) {
    const dir = (fcMatch[1] || "TD").toUpperCase() as Direction;
    return parseFlowchart(rest, dir);
  }

  // Fallback: try flowchart with all lines (no header)
  return parseFlowchart(lines, "TD");
};
