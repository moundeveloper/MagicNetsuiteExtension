<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { parseDiagram } from "../utils/diagramParser";
import {
  calculateLayout,
  type LayoutNode,
  type LayoutEdge,
  type LayoutParticipant,
  type LayoutSeqMessage,
} from "../utils/diagramLayout";

interface Props {
  source: string;
}

const props = defineProps<Props>();

/** Unique prefix for SVG marker IDs to avoid collisions with multiple diagrams. */
const uid = `dg-${Math.random().toString(36).slice(2, 8)}`;

const layout = computed(() => {
  try {
    const parsed = parseDiagram(props.source);
    return calculateLayout(parsed);
  } catch {
    return null;
  }
});

// ── Pan / zoom ──────────────────────────────────────

const svgRef = ref<SVGSVGElement | null>(null);
const isPanning = ref(false);
const vb = ref({ x: 0, y: 0, w: 400, h: 300 });
const vbString = computed(
  () => `${vb.value.x} ${vb.value.y} ${vb.value.w} ${vb.value.h}`
);

const fitToContent = () => {
  if (!layout.value) return;
  const pad = 20;
  vb.value = {
    x: -pad,
    y: -pad,
    w: layout.value.width + pad * 2,
    h: layout.value.height + pad * 2,
  };
};

watch(layout, () => nextTick(fitToContent), { immediate: true });

interface VBPoint {
  x: number;
  y: number;
}

/**
 * Convert a client-space coordinate to viewBox space,
 * correctly accounting for xMidYMid meet letterboxing.
 */
const clientToVB = (clientX: number, clientY: number): VBPoint => {
  const svg = svgRef.value;
  if (!svg) return { x: 0, y: 0 };
  const rect = svg.getBoundingClientRect();
  const { x, y, w, h } = vb.value;
  const scale = Math.min(rect.width / w, rect.height / h);
  const renderW = w * scale;
  const renderH = h * scale;
  const offX = (rect.width - renderW) / 2;
  const offY = (rect.height - renderH) / 2;
  return {
    x: x + (clientX - rect.left - offX) / scale,
    y: y + (clientY - rect.top - offY) / scale,
  };
};

/** Zoom by `factor` centered on the SVG center (used by buttons). */
const zoom = (factor: number) => {
  const svg = svgRef.value;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const center = clientToVB(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const { x, y, w, h } = vb.value;
  vb.value = {
    x: center.x - (center.x - x) * factor,
    y: center.y - (center.y - y) * factor,
    w: w * factor,
    h: h * factor,
  };
};

/** Wheel — zoom toward the cursor position. */
const handleWheel = (e: WheelEvent) => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
  const cursor = clientToVB(e.clientX, e.clientY);
  const { x, y, w, h } = vb.value;
  vb.value = {
    x: cursor.x - (cursor.x - x) * factor,
    y: cursor.y - (cursor.y - y) * factor,
    w: w * factor,
    h: h * factor,
  };
};

let panStart = { x: 0, y: 0, vbX: 0, vbY: 0 };

const handleMouseDown = (e: MouseEvent) => {
  if (e.button !== 0) return;
  isPanning.value = true;
  panStart = { x: e.clientX, y: e.clientY, vbX: vb.value.x, vbY: vb.value.y };
  e.preventDefault();
};

const handleMouseMove = (e: MouseEvent) => {
  if (!isPanning.value) return;
  const svg = svgRef.value;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const { w, h } = vb.value;
  const scale = Math.min(rect.width / w, rect.height / h);
  vb.value = {
    ...vb.value,
    x: panStart.vbX - (e.clientX - panStart.x) / scale,
    y: panStart.vbY - (e.clientY - panStart.y) / scale,
  };
};

const stopPan = () => {
  isPanning.value = false;
};

// ── Shape color palette ──────────────────────────

const shapeColors: Record<string, { fill: string; stroke: string }> = {
  rect:     { fill: "#eff6ff", stroke: "#3b82f6" },
  rounded:  { fill: "#f0fdf4", stroke: "#22c55e" },
  diamond:  { fill: "#fffbeb", stroke: "#f59e0b" },
  cylinder: { fill: "#eef2ff", stroke: "#6366f1" },
  circle:   { fill: "#f0f9ff", stroke: "#0ea5e9" },
  hexagon:  { fill: "#faf5ff", stroke: "#a855f7" },
  stadium:  { fill: "#f8fafc", stroke: "#64748b" },
};

const getColors = (shape: string): { fill: string; stroke: string } =>
  shapeColors[shape] ?? { fill: "#eff6ff", stroke: "#3b82f6" };

// ── SVG path helpers ─────────────────────────────

/** Diamond polygon points string */
const diamondPoints = (n: LayoutNode): string => {
  const hw = n.width / 2;
  const hh = n.height / 2;
  return `${n.x},${n.y - hh} ${n.x + hw},${n.y} ${n.x},${n.y + hh} ${n.x - hw},${n.y}`;
};

/** Hexagon polygon points string */
const hexagonPoints = (n: LayoutNode): string => {
  const hw = n.width / 2;
  const hh = n.height / 2;
  const indent = n.width * 0.18;
  return [
    `${n.x - hw + indent},${n.y - hh}`,
    `${n.x + hw - indent},${n.y - hh}`,
    `${n.x + hw},${n.y}`,
    `${n.x + hw - indent},${n.y + hh}`,
    `${n.x - hw + indent},${n.y + hh}`,
    `${n.x - hw},${n.y}`,
  ].join(" ");
};

/**
 * Cylinder SVG path — a rect body with elliptical top (3D) and bottom arc.
 * ry = curvature of the ellipse cap.
 */
const cylinderBodyPath = (n: LayoutNode): string => {
  const hw = n.width / 2;
  const hh = n.height / 2;
  const ry = 8;
  const top = n.y - hh;
  const bot = n.y + hh;
  const left = n.x - hw;
  const right = n.x + hw;
  return `M ${left} ${top + ry} L ${left} ${bot - ry} A ${hw} ${ry} 0 0 0 ${right} ${bot - ry} L ${right} ${top + ry} Z`;
};

const cylinderTopPath = (n: LayoutNode): string => {
  const hw = n.width / 2;
  const hh = n.height / 2;
  const ry = 8;
  const top = n.y - hh;
  const left = n.x - hw;
  const right = n.x + hw;
  return `M ${left} ${top + ry} A ${hw} ${ry} 0 1 1 ${right} ${top + ry} A ${hw} ${ry} 0 1 1 ${left} ${top + ry} Z`;
};

/** Edge stroke style */
const edgeStroke = (e: LayoutEdge) => {
  if (e.style === "thick") return { width: 2.5, dash: "" };
  if (e.style === "dashed") return { width: 1.5, dash: "6 3" };
  return { width: 1.5, dash: "" };
};

/** Split a node label on \n for multi-line SVG rendering */
const labelLines = (label: string): string[] => label.split("\n");

/**
 * Y baseline for the first line of a node label, vertically centered
 * within the node. LINE_H must match the dy used in the template tspan.
 */
const LINE_H = 15;
const nodeLabelStartY = (node: LayoutNode): number => {
  const n = labelLines(node.label).length;
  // Offset from center: shift up by half the total block height, then add
  // a small baseline offset (+4) so single-line text stays centred.
  return node.y - ((n - 1) * LINE_H) / 2 + 4;
};
const seqArrowPoints = (msg: LayoutSeqMessage): string => {
  const dir = msg.toX > msg.fromX ? 1 : -1;
  const tipX = msg.isSelf ? msg.fromX : msg.toX;
  const tipY = msg.isSelf ? msg.y + 24 : msg.y;
  return `${tipX},${tipY} ${tipX - 7 * dir},${tipY - 4} ${tipX - 7 * dir},${tipY + 4}`;
};

/** Self-message path (loop to the right and back down) */
const selfMsgPath = (msg: LayoutSeqMessage): string => {
  const x = msg.fromX;
  const y1 = msg.y;
  const y2 = msg.y + 24;
  const loopW = 36;
  return `M ${x} ${y1} L ${x + loopW} ${y1} L ${x + loopW} ${y2} L ${x} ${y2}`;
};
</script>

<template>
  <div class="diagram-viewer" v-if="layout">
    <!-- Zoom control buttons -->
    <div class="diagram-controls">
      <button class="zoom-btn" title="Zoom in" @click="zoom(1 / 1.25)">+</button>
      <button class="zoom-btn" title="Fit to content" @click="fitToContent">⊞</button>
      <button class="zoom-btn" title="Zoom out" @click="zoom(1.25)">−</button>
    </div>

    <svg
      ref="svgRef"
      :viewBox="vbString"
      width="100%"
      height="420"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      :style="{ cursor: isPanning ? 'grabbing' : 'grab', display: 'block' }"
      @wheel.prevent="handleWheel"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="stopPan"
      @mouseleave="stopPan"
    >
      <!-- ── Defs: arrowhead markers ── -->
      <defs>
        <marker
          :id="`${uid}-arrow`"
          viewBox="0 0 10 6"
          refX="10"
          refY="3"
          markerWidth="8"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 3 L 0 6 z" fill="#64748b" />
        </marker>
        <marker
          :id="`${uid}-arrow-thick`"
          viewBox="0 0 10 6"
          refX="10"
          refY="3"
          markerWidth="9"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 3 L 0 6 z" fill="#475569" />
        </marker>
        <marker
          :id="`${uid}-arrow-dashed`"
          viewBox="0 0 10 6"
          refX="10"
          refY="3"
          markerWidth="8"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 3 L 0 6 z" fill="#94a3b8" />
        </marker>
      </defs>

      <!-- ════════════════════════════════════════ -->
      <!-- FLOWCHART -->
      <!-- ════════════════════════════════════════ -->

      <template v-if="layout.type === 'flowchart'">
        <!-- ── Subgraph boundaries ── -->
        <g v-for="sg in layout.subgraphs" :key="'sg-' + sg.id">
          <rect
            :x="sg.x"
            :y="sg.y"
            :width="sg.width"
            :height="sg.height"
            rx="8"
            class="sg-border"
          />
          <text
            :x="sg.x + 10"
            :y="sg.y + 14"
            class="sg-label"
          >{{ sg.label }}</text>
        </g>

        <!-- ── Edges ── -->
        <g v-for="(edge, ei) in layout.edges" :key="'e-' + ei">
          <path
            :d="edge.path"
            fill="none"
            :stroke="edge.style === 'thick' ? '#475569' : edge.style === 'dashed' ? '#94a3b8' : '#64748b'"
            :stroke-width="edgeStroke(edge).width"
            :stroke-dasharray="edgeStroke(edge).dash || undefined"
            :marker-end="edge.hasArrow ? `url(#${uid}-arrow${edge.style === 'thick' ? '-thick' : edge.style === 'dashed' ? '-dashed' : ''})` : undefined"
          />
          <!-- Edge label -->
          <g v-if="edge.label">
            <rect
              :x="edge.labelX - (edge.label.length * 3.5 + 8)"
              :y="edge.labelY - 8"
              :width="edge.label.length * 7 + 16"
              :height="16"
              rx="3"
              class="edge-label-bg"
            />
            <text
              :x="edge.labelX"
              :y="edge.labelY + 3"
              text-anchor="middle"
              class="edge-label"
            >{{ edge.label }}</text>
          </g>
        </g>

        <!-- ── Nodes ── -->
        <g v-for="node in layout.nodes" :key="'n-' + node.id">
          <!-- Rect -->
          <rect
            v-if="node.shape === 'rect'"
            :x="node.x - node.width / 2"
            :y="node.y - node.height / 2"
            :width="node.width"
            :height="node.height"
            rx="4"
            :fill="getColors(node.shape).fill"
            :stroke="getColors(node.shape).stroke"
            stroke-width="1.5"
          />

          <!-- Rounded rect -->
          <rect
            v-else-if="node.shape === 'rounded'"
            :x="node.x - node.width / 2"
            :y="node.y - node.height / 2"
            :width="node.width"
            :height="node.height"
            :rx="node.height / 2"
            :fill="getColors(node.shape).fill"
            :stroke="getColors(node.shape).stroke"
            stroke-width="1.5"
          />

          <!-- Stadium -->
          <rect
            v-else-if="node.shape === 'stadium'"
            :x="node.x - node.width / 2"
            :y="node.y - node.height / 2"
            :width="node.width"
            :height="node.height"
            :rx="node.height / 2"
            :fill="getColors(node.shape).fill"
            :stroke="getColors(node.shape).stroke"
            stroke-width="1.5"
          />

          <!-- Diamond -->
          <polygon
            v-else-if="node.shape === 'diamond'"
            :points="diamondPoints(node)"
            :fill="getColors(node.shape).fill"
            :stroke="getColors(node.shape).stroke"
            stroke-width="1.5"
          />

          <!-- Circle -->
          <ellipse
            v-else-if="node.shape === 'circle'"
            :cx="node.x"
            :cy="node.y"
            :rx="node.width / 2"
            :ry="node.height / 2"
            :fill="getColors(node.shape).fill"
            :stroke="getColors(node.shape).stroke"
            stroke-width="1.5"
          />

          <!-- Hexagon -->
          <polygon
            v-else-if="node.shape === 'hexagon'"
            :points="hexagonPoints(node)"
            :fill="getColors(node.shape).fill"
            :stroke="getColors(node.shape).stroke"
            stroke-width="1.5"
          />

          <!-- Cylinder -->
          <g v-else-if="node.shape === 'cylinder'">
            <path
              :d="cylinderBodyPath(node)"
              :fill="getColors(node.shape).fill"
              :stroke="getColors(node.shape).stroke"
              stroke-width="1.5"
            />
            <path
              :d="cylinderTopPath(node)"
              :fill="getColors(node.shape).fill"
              :stroke="getColors(node.shape).stroke"
              stroke-width="1.5"
            />
          </g>

          <!-- Node label (supports \n multi-line via tspan) -->
          <text
            :x="node.x"
            :y="nodeLabelStartY(node)"
            text-anchor="middle"
            class="node-label"
          >
            <tspan
              v-for="(line, li) in labelLines(node.label)"
              :key="li"
              :x="node.x"
              :dy="li === 0 ? 0 : LINE_H"
            >{{ line }}</tspan>
          </text>
        </g>
      </template>

      <!-- ════════════════════════════════════════ -->
      <!-- SEQUENCE -->
      <!-- ════════════════════════════════════════ -->

      <template v-if="layout.type === 'sequence'">
        <!-- ── Lifelines ── -->
        <line
          v-for="p in layout.participants"
          :key="'life-' + p.id"
          :x1="p.x"
          :y1="p.lineTopY"
          :x2="p.x"
          :y2="p.lineBottomY"
          class="seq-lifeline"
        />

        <!-- ── Messages ── -->
        <g v-for="(msg, mi) in layout.seqMessages" :key="'msg-' + mi">
          <!-- Self-message (loop) -->
          <template v-if="msg.isSelf">
            <path
              :d="selfMsgPath(msg)"
              fill="none"
              :stroke="msg.dashed ? '#94a3b8' : '#64748b'"
              :stroke-width="1.5"
              :stroke-dasharray="msg.dashed ? '6 3' : undefined"
            />
            <polygon
              :points="seqArrowPoints(msg)"
              :fill="msg.dashed ? '#94a3b8' : '#64748b'"
            />
            <text
              :x="msg.fromX + 40"
              :y="msg.y + 10"
              class="seq-msg-label"
            >{{ msg.label }}</text>
          </template>

          <!-- Normal message -->
          <template v-else>
            <line
              :x1="msg.fromX"
              :y1="msg.y"
              :x2="msg.toX"
              :y2="msg.y"
              :stroke="msg.dashed ? '#94a3b8' : '#64748b'"
              :stroke-width="1.5"
              :stroke-dasharray="msg.dashed ? '6 3' : undefined"
            />
            <polygon
              :points="seqArrowPoints(msg)"
              :fill="msg.dashed ? '#94a3b8' : '#64748b'"
            />
            <text
              :x="(msg.fromX + msg.toX) / 2"
              :y="msg.y - 7"
              text-anchor="middle"
              class="seq-msg-label"
            >{{ msg.label }}</text>
          </template>
        </g>

        <!-- ── Notes ── -->
        <g v-for="(note, ni) in layout.seqNotes" :key="'note-' + ni">
          <rect
            :x="note.x"
            :y="note.y"
            :width="note.width"
            :height="note.height"
            rx="3"
            class="seq-note-box"
          />
          <text
            :x="note.x + note.width / 2"
            :y="note.y + note.height / 2 + 4"
            text-anchor="middle"
            class="seq-note-text"
          >{{ note.text }}</text>
        </g>

        <!-- ── Participant boxes (top) ── -->
        <g v-for="p in layout.participants" :key="'part-' + p.id">
          <rect
            :x="p.x - p.boxWidth / 2"
            :y="p.boxY"
            :width="p.boxWidth"
            :height="p.boxHeight"
            rx="5"
            class="seq-part-box"
          />
          <text
            :x="p.x"
            :y="p.boxY + p.boxHeight / 2 + 4"
            text-anchor="middle"
            class="seq-part-label"
          >{{ p.label }}</text>
        </g>

        <!-- ── Participant boxes (bottom, mirrored) ── -->
        <g v-for="p in layout.participants" :key="'part-bot-' + p.id">
          <rect
            :x="p.x - p.boxWidth / 2"
            :y="p.lineBottomY"
            :width="p.boxWidth"
            :height="p.boxHeight"
            rx="5"
            class="seq-part-box"
          />
          <text
            :x="p.x"
            :y="p.lineBottomY + p.boxHeight / 2 + 4"
            text-anchor="middle"
            class="seq-part-label"
          >{{ p.label }}</text>
        </g>
      </template>
    </svg>
  </div>

  <!-- Fallback: render raw source if parsing failed -->
  <pre v-else class="diagram-fallback">{{ props.source }}</pre>
</template>

<style scoped>
.diagram-viewer {
  position: relative;
  overflow: hidden;
  padding: 0.75rem;
  background: #fafbfc;
  border-radius: 0 0 0.5rem 0.5rem;
}

/* ── Zoom controls ── */
.diagram-controls {
  position: absolute;
  bottom: 1rem;
  right: 1rem;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.zoom-btn {
  width: 26px;
  height: 26px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.9);
  color: #475569;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.1s, border-color 0.1s;
}

.zoom-btn:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}

.diagram-fallback {
  padding: 0.75rem;
  font-size: 0.8rem;
  color: var(--p-slate-600);
  background: var(--p-slate-50);
  border-radius: 0 0 0.5rem 0.5rem;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── Node labels ── */
.node-label {
  font-family: Inter, system-ui, sans-serif;
  font-size: 12px;
  font-weight: 500;
  fill: #1e293b;
  pointer-events: none;
}

/* ── Edge labels ── */
.edge-label {
  font-family: Inter, system-ui, sans-serif;
  font-size: 10.5px;
  font-weight: 500;
  fill: #475569;
  pointer-events: none;
}

.edge-label-bg {
  fill: #fafbfc;
  stroke: #e2e8f0;
  stroke-width: 0.75;
}

/* ── Subgraphs ── */
.sg-border {
  fill: rgba(241, 245, 249, 0.55);
  stroke: #cbd5e1;
  stroke-width: 1;
  stroke-dasharray: 5 3;
}

.sg-label {
  font-family: Inter, system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  fill: #64748b;
  pointer-events: none;
}

/* ── Sequence: lifelines ── */
.seq-lifeline {
  stroke: #cbd5e1;
  stroke-width: 1;
  stroke-dasharray: 5 4;
}

/* ── Sequence: participant boxes ── */
.seq-part-box {
  fill: #eff6ff;
  stroke: #3b82f6;
  stroke-width: 1.5;
}

.seq-part-label {
  font-family: Inter, system-ui, sans-serif;
  font-size: 12px;
  font-weight: 600;
  fill: #1e293b;
  pointer-events: none;
}

/* ── Sequence: message labels ── */
.seq-msg-label {
  font-family: Inter, system-ui, sans-serif;
  font-size: 11px;
  font-weight: 500;
  fill: #334155;
  pointer-events: none;
}

/* ── Sequence: note boxes ── */
.seq-note-box {
  fill: #fffbeb;
  stroke: #f59e0b;
  stroke-width: 1;
}

.seq-note-text {
  font-family: Inter, system-ui, sans-serif;
  font-size: 10.5px;
  font-style: italic;
  fill: #92400e;
  pointer-events: none;
}
</style>
