export interface PdfPage {
  pageNumber: number;
  text: string;
}

export interface PdfTextResult {
  pages: PdfPage[];
  fullText: string;
  pageCount: number;
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

export const extractPdfText = async (file: File): Promise<PdfTextResult> => {
  const pdfjsLib = await import("pdfjs-dist");

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url
  ).toString();

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
