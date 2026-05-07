/**
 * Layout engine for parsed diagrams.
 * Takes a ParsedDiagram and calculates absolute positions for all elements.
 */

import type {
  ParsedDiagram,
  DiagramNode,
  DiagramEdge,
  NodeShape,
  SubgraphDef,
  Participant,
  SeqMessage,
  SeqNote,
} from "./diagramParser";

// ── Layout types ───────────────────────────────────

export interface LayoutNode {
  id: string;
  x: number; // center x
  y: number; // center y
  width: number;
  height: number;
  label: string;
  shape: NodeShape;
}

export interface LayoutEdge {
  from: string;
  to: string;
  label?: string;
  style: "solid" | "dashed" | "thick";
  hasArrow: boolean;
  /** SVG path data string (M ... C ... or M ... L ...) */
  path: string;
  /** Midpoint for label placement */
  labelX: number;
  labelY: number;
}

export interface LayoutSubgraph {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutParticipant {
  id: string;
  label: string;
  x: number; // center x
  boxY: number; // top of participant box
  boxWidth: number;
  boxHeight: number;
  lineTopY: number; // top of lifeline
  lineBottomY: number; // bottom of lifeline
}

export interface LayoutSeqMessage {
  fromX: number;
  toX: number;
  y: number;
  label: string;
  dashed: boolean;
  isSelf: boolean;
}

export interface LayoutSeqNote {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface DiagramLayout {
  type: "flowchart" | "sequence";
  width: number;
  height: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  subgraphs: LayoutSubgraph[];
  participants: LayoutParticipant[];
  seqMessages: LayoutSeqMessage[];
  seqNotes: LayoutSeqNote[];
}

// ── Constants ──────────────────────────────────────

const CHAR_WIDTH = 8.0;
const NODE_PAD_X = 28;
const NODE_PAD_Y = 12;
const NODE_MIN_WIDTH = 70;
const NODE_HEIGHT = 38;
const RANK_GAP = 80;   // min gap between the bottom of one rank and the top of the next
const NODE_GAP = 54;   // horizontal gap between nodes in the same rank
const PADDING = 40;    // canvas padding

const SEQ_PARTICIPANT_GAP = 160;
const SEQ_PARTICIPANT_BOX_PAD = 20;
const SEQ_PARTICIPANT_BOX_H = 36;
const SEQ_MESSAGE_STEP = 52;
const SEQ_NOTE_WIDTH = 120;
const SEQ_NOTE_HEIGHT = 30;
const SEQ_PAD = 30;

// ── Text measurement ───────────────────────────────

const estimateTextWidth = (text: string): number => {
  // Use the longest line for width estimation (handles \n-split labels)
  const lines = text.split("\n");
  return Math.max(...lines.map((l) => l.length * CHAR_WIDTH));
};

// ── Node dimension calculation ─────────────────────

const getNodeDimensions = (
  node: DiagramNode
): { width: number; height: number } => {
  const textW = estimateTextWidth(node.label);
  // Extra height per additional line (for \n-split multi-line labels)
  const lineCount = (node.label.match(/\n/g) || []).length + 1;
  const extraH = (lineCount - 1) * 16;

  switch (node.shape) {
    case "diamond": {
      const w = Math.max(textW + NODE_PAD_X * 2, 80);
      return { width: w, height: Math.max(Math.round(w * 0.55), 44) + extraH };
    }
    case "circle": {
      const d = Math.max(textW + NODE_PAD_X, 50) + extraH;
      return { width: d, height: d };
    }
    case "hexagon":
      return {
        width: Math.max(textW + NODE_PAD_X * 2.5, NODE_MIN_WIDTH),
        height: NODE_HEIGHT + extraH,
      };
    default:
      return {
        width: Math.max(textW + NODE_PAD_X * 2, NODE_MIN_WIDTH),
        height: NODE_HEIGHT + extraH,
      };
  }
};

// ── Edge path generation (orthogonal / right-angle routing) ──────

/**
 * Build an orthogonal SVG path (only horizontal + vertical segments) that
 * connects two nodes face-to-face.
 *
 * TD/TB layout  → primary flow is vertical:
 *   forward edges  exit bottom face, enter top face   (Z-shape)
 *   back/cycle     exit top face,   enter bottom face (Z-shape, or detour left)
 *   same-rank      exit right/left, enter left/right  (Z-shape sideways)
 *
 * LR/RL layout  → primary flow is horizontal:
 *   forward edges  exit right face, enter left face   (Z-shape)
 *   back/cycle     exit left face,  enter right face  (Z-shape, or detour above)
 *   same-column    exit bottom/top, enter top/bottom  (Z-shape vertically)
 */
const buildEdgePath = (
  fromNode: LayoutNode,
  toNode: LayoutNode,
  isVertical: boolean
): { path: string; labelX: number; labelY: number } => {
  const fdx = toNode.x - fromNode.x;
  const fdy = toNode.y - fromNode.y;

  // ── TD / TB (vertical flow) ──────────────────────────────────────
  if (isVertical) {
    if (Math.abs(fdy) > 5) {
      // Nodes at different vertical positions → use top/bottom faces
      const fromFY = fdy > 0
        ? fromNode.y + fromNode.height / 2   // exit bottom face
        : fromNode.y - fromNode.height / 2;  // exit top face
      const toFY = fdy > 0
        ? toNode.y - toNode.height / 2       // enter top face
        : toNode.y + toNode.height / 2;      // enter bottom face
      const fromFX = fromNode.x;
      const toFX   = toNode.x;

      // Is there clear space in the primary direction?
      const gap = fdy > 0 ? toFY - fromFY : fromFY - toFY;

      if (gap > 4) {
        if (Math.abs(fromFX - toFX) < 2) {
          // Same column — straight vertical line
          return {
            path: `M ${fromFX} ${fromFY} L ${toFX} ${toFY}`,
            labelX: fromFX,
            labelY: (fromFY + toFY) / 2 - 8,
          };
        }
        // Z-shape: vertical → horizontal jog → vertical
        const midY = (fromFY + toFY) / 2;
        return {
          path: `M ${fromFX} ${fromFY} L ${fromFX} ${midY} L ${toFX} ${midY} L ${toFX} ${toFY}`,
          labelX: (fromFX + toFX) / 2,
          labelY: midY - 8,
        };
      }

      // Nodes overlap on the primary axis (cycle / very tight back-edge)
      // → detour around the left side
      const detourX = Math.min(
        fromNode.x - fromNode.width / 2,
        toNode.x   - toNode.width  / 2
      ) - 28;
      const exitY  = fdy < 0 ? fromFY - 10 : fromFY + 10;
      const entryY = fdy < 0 ? toFY   + 10 : toFY   - 10;
      return {
        path:
          `M ${fromFX} ${fromFY} L ${fromFX} ${exitY} ` +
          `L ${detourX} ${exitY} L ${detourX} ${entryY} ` +
          `L ${toFX} ${entryY} L ${toFX} ${toFY}`,
        labelX: detourX - 15,
        labelY: (exitY + entryY) / 2,
      };
    }

    // Same rank (lateral) → connect left/right faces
    const goRight = fdx >= 0;
    const fromFX  = goRight
      ? fromNode.x + fromNode.width / 2
      : fromNode.x - fromNode.width / 2;
    const toFX    = goRight
      ? toNode.x - toNode.width / 2
      : toNode.x + toNode.width / 2;
    const fromFY  = fromNode.y;
    const toFY    = toNode.y;

    if (Math.abs(fromFY - toFY) < 2) {
      // Exactly same Y — straight horizontal line
      return {
        path: `M ${fromFX} ${fromFY} L ${toFX} ${toFY}`,
        labelX: (fromFX + toFX) / 2,
        labelY: fromFY - 8,
      };
    }
    const midX = (fromFX + toFX) / 2;
    return {
      path: `M ${fromFX} ${fromFY} L ${midX} ${fromFY} L ${midX} ${toFY} L ${toFX} ${toFY}`,
      labelX: midX,
      labelY: (fromFY + toFY) / 2 - 8,
    };
  }

  // ── LR / RL (horizontal flow) ────────────────────────────────────
  if (Math.abs(fdx) > 5) {
    // Nodes at different horizontal positions → use left/right faces
    const fromFX = fdx > 0
      ? fromNode.x + fromNode.width  / 2   // exit right face
      : fromNode.x - fromNode.width  / 2;  // exit left face
    const toFX = fdx > 0
      ? toNode.x - toNode.width  / 2       // enter left face
      : toNode.x + toNode.width  / 2;      // enter right face
    const fromFY = fromNode.y;
    const toFY   = toNode.y;

    const gap = fdx > 0 ? toFX - fromFX : fromFX - toFX;

    if (gap > 4) {
      if (Math.abs(fromFY - toFY) < 2) {
        // Same row — straight horizontal line
        return {
          path: `M ${fromFX} ${fromFY} L ${toFX} ${toFY}`,
          labelX: (fromFX + toFX) / 2,
          labelY: fromFY - 8,
        };
      }
      // Z-shape: horizontal → vertical jog → horizontal
      const midX = (fromFX + toFX) / 2;
      return {
        path: `M ${fromFX} ${fromFY} L ${midX} ${fromFY} L ${midX} ${toFY} L ${toFX} ${toFY}`,
        labelX: midX,
        labelY: (fromFY + toFY) / 2 - 8,
      };
    }

    // Horizontal overlap (back/cycle edge) → detour above
    const detourY = Math.min(
      fromNode.y - fromNode.height / 2,
      toNode.y   - toNode.height  / 2
    ) - 28;
    return {
      path:
        `M ${fromFX} ${fromFY} L ${fromFX} ${detourY} ` +
        `L ${toFX} ${detourY} L ${toFX} ${toFY}`,
      labelX: (fromFX + toFX) / 2,
      labelY: detourY - 8,
    };
  }

  // Same column (lateral in LR) → connect top/bottom faces
  const goDown = fdy >= 0;
  const fromFY = goDown
    ? fromNode.y + fromNode.height / 2
    : fromNode.y - fromNode.height / 2;
  const toFY = goDown
    ? toNode.y - toNode.height / 2
    : toNode.y + toNode.height / 2;
  const fromFX = fromNode.x;
  const toFX   = toNode.x;

  if (Math.abs(fromFX - toFX) < 2) {
    return {
      path: `M ${fromFX} ${fromFY} L ${toFX} ${toFY}`,
      labelX: fromFX,
      labelY: (fromFY + toFY) / 2 - 8,
    };
  }
  const midY = (fromFY + toFY) / 2;
  return {
    path: `M ${fromFX} ${fromFY} L ${fromFX} ${midY} L ${toFX} ${midY} L ${toFX} ${toFY}`,
    labelX: (fromFX + toFX) / 2,
    labelY: midY - 8,
  };
};

// ── Flowchart layout ───────────────────────────────

const layoutFlowchart = (diagram: ParsedDiagram): DiagramLayout => {
  const { nodes, edges, subgraphs, direction } = diagram;
  const isVertical = direction === "TD" || direction === "TB" || direction === "BT";
  const isReversed = direction === "BT" || direction === "RL";

  if (nodes.size === 0) {
    return {
      type: "flowchart",
      width: 100,
      height: 50,
      nodes: [],
      edges: [],
      subgraphs: [],
      participants: [],
      seqMessages: [],
      seqNotes: [],
    };
  }

  // 1. Build adjacency and compute in-degrees
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const [id] of nodes) {
    adj.set(id, []);
    inDeg.set(id, 0);
  }
  for (const e of edges) {
    if (adj.has(e.from) && nodes.has(e.to)) {
      adj.get(e.from)!.push(e.to);
      inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
    }
  }

  // 2. Rank assignment via longest-path BFS
  const rank = new Map<string, number>();
  const queue: string[] = [];
  for (const [id] of nodes) {
    if ((inDeg.get(id) || 0) === 0) {
      queue.push(id);
      rank.set(id, 0);
    }
  }
  // Handle graphs with no sources (all cycles)
  if (queue.length === 0) {
    const firstId = nodes.keys().next().value!;
    queue.push(firstId);
    rank.set(firstId, 0);
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const u = queue.shift()!;
    if (visited.has(u)) continue;
    visited.add(u);
    for (const v of adj.get(u) || []) {
      const newRank = (rank.get(u) || 0) + 1;
      if (newRank > (rank.get(v) || 0)) {
        rank.set(v, newRank);
      }
      const remaining = (inDeg.get(v) || 1) - 1;
      inDeg.set(v, remaining);
      if (remaining <= 0 && !visited.has(v)) {
        queue.push(v);
      }
    }
  }

  // Assign unvisited nodes to rank 0
  for (const [id] of nodes) {
    if (!rank.has(id)) rank.set(id, 0);
  }

  // 3. Group nodes by rank
  const maxRank = Math.max(...Array.from(rank.values()), 0);
  const rankGroups = new Map<number, string[]>();
  for (let r = 0; r <= maxRank; r++) rankGroups.set(r, []);
  for (const [id] of nodes) {
    const r = rank.get(id) || 0;
    rankGroups.get(r)!.push(id);
  }

  // 4. Simple median ordering pass to reduce crossings
  for (let r = 1; r <= maxRank; r++) {
    const group = rankGroups.get(r)!;
    const prevGroup = rankGroups.get(r - 1)!;
    const prevOrder = new Map(prevGroup.map((id, idx) => [id, idx]));

    // For each node in this rank, compute median position of parents
    const medians = group.map((id) => {
      const parents: number[] = [];
      for (const e of edges) {
        if (e.to === id && prevOrder.has(e.from)) {
          parents.push(prevOrder.get(e.from)!);
        }
      }
      if (parents.length === 0) return { id, median: Infinity };
      parents.sort((a, b) => a - b);
      return { id, median: parents[Math.floor(parents.length / 2)]! };
    });

    medians.sort((a, b) => a.median - b.median);
    rankGroups.set(
      r,
      medians.map((m) => m.id)
    );
  }

  // 5. Calculate node dimensions
  const nodeDims = new Map<string, { w: number; h: number }>();
  for (const [id, node] of nodes) {
    const d = getNodeDimensions(node);
    nodeDims.set(id, { w: d.width, h: d.height });
  }

  // 5.5. Compute per-rank max flow-dimension, then build cumulative center positions.
  // This ensures ranks are spaced by the ACTUAL tallest node in each rank, not a fixed gap.
  const rankMaxFlow = new Map<number, number>();
  for (const [id] of nodes) {
    const r = rank.get(id) || 0;
    const d = nodeDims.get(id)!;
    rankMaxFlow.set(r, Math.max(rankMaxFlow.get(r) || 0, isVertical ? d.h : d.w));
  }
  const rankCenterPos: number[] = [];
  {
    let pos = PADDING;
    for (let r = 0; r <= maxRank; r++) {
      const sz = rankMaxFlow.get(r) || NODE_HEIGHT;
      rankCenterPos.push(pos + sz / 2); // center of this rank band
      pos += sz + RANK_GAP;             // advance past this band + gap
    }
  }

  // 6. Position nodes
  const layoutNodes: LayoutNode[] = [];
  const nodePositions = new Map<string, LayoutNode>();

  // Calculate max rank span (cross-axis) for centering
  let maxRankSpan = 0;
  for (let r = 0; r <= maxRank; r++) {
    const group = rankGroups.get(r)!;
    let span = 0;
    for (const id of group) {
      const d = nodeDims.get(id)!;
      span += (isVertical ? d.w : d.h) + NODE_GAP;
    }
    span -= NODE_GAP;
    maxRankSpan = Math.max(maxRankSpan, span);
  }

  for (let r = 0; r <= maxRank; r++) {
    const group = rankGroups.get(r)!;

    // Total span of this rank
    let rankSpan = 0;
    for (const id of group) {
      const d = nodeDims.get(id)!;
      rankSpan += (isVertical ? d.w : d.h) + NODE_GAP;
    }
    rankSpan -= NODE_GAP;

    // Starting offset (centered)
    let offset = (maxRankSpan - rankSpan) / 2 + PADDING;

    // All nodes in the same rank share the SAME center on the flow axis.
    // Previously used `flowPos + mainSize/2` which shifted each node by its own
    // height — causing different y-centers per node and overlap with adjacent ranks.
    const actualR = isReversed ? maxRank - r : r;
    const flowPos = rankCenterPos[actualR]!;

    for (const id of group) {
      const node = nodes.get(id)!;
      const d = nodeDims.get(id)!;
      const crossSize = isVertical ? d.w : d.h;

      // cx/cy are the CENTER of the node — no mainSize offset needed
      const cx = isVertical ? offset + crossSize / 2 : flowPos;
      const cy = isVertical ? flowPos : offset + crossSize / 2;

      const ln: LayoutNode = {
        id,
        x: cx,
        y: cy,
        width: d.w,
        height: d.h,
        label: node.label,
        shape: node.shape,
      };
      layoutNodes.push(ln);
      nodePositions.set(id, ln);

      offset += crossSize + NODE_GAP;
    }
  }

  // 7. Build edges
  const layoutEdges: LayoutEdge[] = [];
  for (const edge of edges) {
    const fromNode = nodePositions.get(edge.from);
    const toNode = nodePositions.get(edge.to);
    if (!fromNode || !toNode) continue;

    const { path, labelX, labelY } = buildEdgePath(
      fromNode,
      toNode,
      isVertical
    );

    layoutEdges.push({
      from: edge.from,
      to: edge.to,
      label: edge.label,
      style: edge.style,
      hasArrow: edge.hasArrow,
      path,
      labelX,
      labelY,
    });
  }

  // 8. Subgraph boundaries
  const layoutSubgraphs: LayoutSubgraph[] = [];
  for (const sg of subgraphs) {
    const sgNodes = sg.nodeIds
      .map((id) => nodePositions.get(id))
      .filter(Boolean) as LayoutNode[];
    if (sgNodes.length === 0) continue;

    const sgPad = 18;
    const labelH = 20;
    const minX = Math.min(...sgNodes.map((n) => n.x - n.width / 2)) - sgPad;
    const minY =
      Math.min(...sgNodes.map((n) => n.y - n.height / 2)) - sgPad - labelH;
    const maxX = Math.max(...sgNodes.map((n) => n.x + n.width / 2)) + sgPad;
    const maxY = Math.max(...sgNodes.map((n) => n.y + n.height / 2)) + sgPad;

    layoutSubgraphs.push({
      id: sg.id,
      label: sg.label,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });
  }

  // 9. Calculate total canvas dimensions
  let totalW = 0;
  let totalH = 0;
  for (const n of layoutNodes) {
    totalW = Math.max(totalW, n.x + n.width / 2);
    totalH = Math.max(totalH, n.y + n.height / 2);
  }
  for (const sg of layoutSubgraphs) {
    totalW = Math.max(totalW, sg.x + sg.width);
    totalH = Math.max(totalH, sg.y + sg.height);
  }

  return {
    type: "flowchart",
    width: totalW + PADDING,
    height: totalH + PADDING,
    nodes: layoutNodes,
    edges: layoutEdges,
    subgraphs: layoutSubgraphs,
    participants: [],
    seqMessages: [],
    seqNotes: [],
  };
};

// ── Sequence layout ────────────────────────────────

const layoutSequence = (diagram: ParsedDiagram): DiagramLayout => {
  const { participants, messages, notes } = diagram;

  if (participants.length === 0) {
    return {
      type: "sequence",
      width: 100,
      height: 50,
      nodes: [],
      edges: [],
      subgraphs: [],
      participants: [],
      seqMessages: [],
      seqNotes: [],
    };
  }

  // Calculate participant box widths
  const partWidths = participants.map((p) => {
    const textW = estimateTextWidth(p.label);
    return Math.max(textW + SEQ_PARTICIPANT_BOX_PAD * 2, 80);
  });

  // Position participants
  const totalPartWidth = partWidths.reduce(
    (sum, w, i) => sum + w + (i > 0 ? SEQ_PARTICIPANT_GAP - w : 0),
    0
  );

  let partX = SEQ_PAD;
  const layoutParts: LayoutParticipant[] = participants.map((p, i) => {
    const bw = partWidths[i] ?? 80;
    const cx = partX + bw / 2;
    partX += SEQ_PARTICIPANT_GAP;

    return {
      id: p.id,
      label: p.label,
      x: cx,
      boxY: SEQ_PAD,
      boxWidth: bw,
      boxHeight: SEQ_PARTICIPANT_BOX_H,
      lineTopY: SEQ_PAD + SEQ_PARTICIPANT_BOX_H,
      lineBottomY: 0, // computed after messages
    };
  });

  // Build participant lookup
  const partLookup = new Map(layoutParts.map((p) => [p.id, p]));

  // Layout messages
  let msgY = SEQ_PAD + SEQ_PARTICIPANT_BOX_H + 30;
  const layoutMsgs: LayoutSeqMessage[] = [];

  for (const msg of messages) {
    const fromPart = partLookup.get(msg.from);
    const toPart = partLookup.get(msg.to);
    if (!fromPart || !toPart) continue;

    const isSelf = msg.from === msg.to;
    layoutMsgs.push({
      fromX: fromPart.x,
      toX: toPart.x,
      y: msgY,
      label: msg.label,
      dashed: msg.dashed,
      isSelf,
    });

    msgY += isSelf ? SEQ_MESSAGE_STEP * 1.3 : SEQ_MESSAGE_STEP;
  }

  // Layout notes
  const layoutNotes: LayoutSeqNote[] = [];
  let noteY = SEQ_PAD + SEQ_PARTICIPANT_BOX_H + 20;
  for (const note of notes) {
    const overParts = note.over
      .map((id) => partLookup.get(id))
      .filter(Boolean) as LayoutParticipant[];
    if (overParts.length === 0) continue;

    const minX = Math.min(...overParts.map((p) => p.x));
    const maxX = Math.max(...overParts.map((p) => p.x));
    const cx = (minX + maxX) / 2;
    const noteW = Math.max(
      estimateTextWidth(note.text) + 20,
      SEQ_NOTE_WIDTH
    );

    layoutNotes.push({
      x: cx - noteW / 2,
      y: noteY,
      width: noteW,
      height: SEQ_NOTE_HEIGHT,
      text: note.text,
    });

    noteY += SEQ_NOTE_HEIGHT + 10;
  }

  // Set lifeline bottom
  const bottomY = msgY + 20;
  for (const p of layoutParts) {
    p.lineBottomY = bottomY;
  }

  // Canvas size
  const totalW =
    Math.max(
      ...layoutParts.map((p) => p.x + p.boxWidth / 2),
      ...layoutNotes.map((n) => n.x + n.width)
    ) + SEQ_PAD;
  const totalH = bottomY + SEQ_PARTICIPANT_BOX_H + SEQ_PAD;

  return {
    type: "sequence",
    width: totalW,
    height: totalH,
    nodes: [],
    edges: [],
    subgraphs: [],
    participants: layoutParts,
    seqMessages: layoutMsgs,
    seqNotes: layoutNotes,
  };
};

// ── Main entry point ───────────────────────────────

export const calculateLayout = (diagram: ParsedDiagram): DiagramLayout => {
  if (diagram.type === "sequence") {
    return layoutSequence(diagram);
  }
  return layoutFlowchart(diagram);
};
