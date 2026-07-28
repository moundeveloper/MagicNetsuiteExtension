export interface PdfPage {
  pageNumber: number;
  text: string;
}

export interface PdfTextResult {
  pages: PdfPage[];
  fullText: string;
  pageCount: number;
}

export interface PdfPageImage {
  dataUrl: string;
  pageNumber: number;
  pageCount: number;
  width: number;
  height: number;
}

interface LineItem {
  x: number;
  str: string;
  height: number;
}

interface LineObject {
  text: string;
  height: number;
  y: number;
}

const loadPdfJs = async () => {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url
  ).toString();
  return pdfjsLib;
};

export const renderPdfDataUrlPage = async (
  dataUrl: string,
  requestedPage = 1,
  targetWidth = 1600
): Promise<PdfPageImage> => {
  const pdfjsLib = await loadPdfJs();
  const pdfBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
  const pdf = await loadingTask.promise;
  const pageNumber = Math.trunc(requestedPage);
  if (pageNumber < 1 || pageNumber > pdf.numPages) {
    throw new Error(
      `PDF page ${requestedPage} is out of range. This document has ${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"}.`
    );
  }

  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.max(1, Math.min(4, targetWidth / baseViewport.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const canvasContext = canvas.getContext("2d", { alpha: false });
  if (!canvasContext) throw new Error("Could not create the PDF page canvas.");
  canvasContext.fillStyle = "#ffffff";
  canvasContext.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas,
    canvasContext,
    viewport,
    background: "rgb(255,255,255)"
  }).promise;

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.92),
    pageNumber,
    pageCount: pdf.numPages,
    width: canvas.width,
    height: canvas.height
  };
};

export const extractPdfText = async (file: File): Promise<PdfTextResult> => {
  const pdfjsLib = await loadPdfJs();

  const arrayBuffer = await file.arrayBuffer();
  const typedArray = new Uint8Array(arrayBuffer);

  const loadingTask = pdfjsLib.getDocument({ data: typedArray });
  const pdf = await loadingTask.promise;
  const pages: PdfPage[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const rawItems = textContent.items.filter(
      (
        item
      ): item is typeof item & {
        str: string;
        transform: number[];
        height: number;
      } =>
        "str" in item &&
        typeof (item as { str?: unknown }).str === "string" &&
        (item as { str: string }).str.trim().length > 0
    );

    if (rawItems.length === 0) {
      pages.push({ pageNumber: i, text: "" });
      continue;
    }

    const BUCKET = 3;
    const lineMap = new Map<number, LineItem[]>();

    for (const item of rawItems) {
      const transform = (item as unknown as { transform: number[] }).transform;
      const height = (item as unknown as { height: number }).height ?? 0;
      const str = (item as { str: string }).str;
      const y = Math.round((transform[5] ?? 0) / BUCKET) * BUCKET;

      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y)!.push({ x: transform[4] ?? 0, str, height });
    }

    const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);
    const lineObjects: LineObject[] = [];

    for (const y of sortedYs) {
      const lineItems = lineMap.get(y)!.sort((a, b) => a.x - b.x);
      const text = lineItems
        .map((it) => it.str)
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .trim();
      const height = Math.max(...lineItems.map((it) => it.height));
      if (text) lineObjects.push({ text, height, y });
    }

    if (lineObjects.length === 0) {
      pages.push({ pageNumber: i, text: "" });
      continue;
    }

    const avgHeight =
      lineObjects.reduce((sum, line) => sum + line.height, 0) /
        lineObjects.length || 12;
    const paragraphThreshold = avgHeight * 1.5;
    const textLines: string[] = [];

    for (let j = 0; j < lineObjects.length; j++) {
      const current = lineObjects[j]!;
      textLines.push(current.text);
      if (j < lineObjects.length - 1) {
        const next = lineObjects[j + 1]!;
        const gap = current.y - next.y;
        if (gap > paragraphThreshold) textLines.push("");
      }
    }

    pages.push({ pageNumber: i, text: textLines.join("\n") });
  }

  return {
    pages,
    fullText: pages.map((page) => page.text).join("\n\n"),
    pageCount: pdf.numPages
  };
};
