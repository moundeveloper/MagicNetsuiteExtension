import {
  makeTemplateImageAsset,
  type TemplateImageAsset,
} from "./sessionStore";

const MAX_ASSET_DIMENSION = 8192;
const MAX_ASSET_PIXELS = 16_000_000;
const MIN_ASSET_DIMENSION = 8;
const SVG_RENDER_SCALE = 4;

const parseSvgLength = (value: string | null): number => {
  const match = String(value || "")
    .trim()
    .match(/^(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
};

const svgDimensions = (
  root: Element,
  requestedWidth?: number,
  requestedHeight?: number,
) => {
  const viewBox = String(root.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const viewBoxWidth =
    viewBox.length === 4 && viewBox.every(Number.isFinite) ? viewBox[2]! : 0;
  const viewBoxHeight =
    viewBox.length === 4 && viewBox.every(Number.isFinite) ? viewBox[3]! : 0;
  const sourceWidth =
    parseSvgLength(root.getAttribute("width")) || viewBoxWidth || 512;
  const sourceHeight =
    parseSvgLength(root.getAttribute("height")) || viewBoxHeight || 512;
  return fitDimensions(
    requestedWidth || sourceWidth,
    requestedHeight ||
      (requestedWidth
        ? requestedWidth * (sourceHeight / sourceWidth)
        : sourceHeight),
  );
};

export const fitTemplateImageDimensions = (
  width: number,
  height: number,
  pixelScale = 1,
) => {
  let nextWidth = Math.max(
    MIN_ASSET_DIMENSION,
    Math.round((width || 512) * pixelScale),
  );
  let nextHeight = Math.max(
    MIN_ASSET_DIMENSION,
    Math.round((height || 512) * pixelScale),
  );
  const dimensionScale = Math.min(
    1,
    MAX_ASSET_DIMENSION / Math.max(nextWidth, nextHeight),
  );
  const pixelLimitScale = Math.min(
    1,
    Math.sqrt(MAX_ASSET_PIXELS / (nextWidth * nextHeight)),
  );
  const scale = Math.min(dimensionScale, pixelLimitScale);
  nextWidth = Math.max(1, Math.round(nextWidth * scale));
  nextHeight = Math.max(1, Math.round(nextHeight * scale));
  return { width: nextWidth, height: nextHeight };
};

const fitDimensions = fitTemplateImageDimensions;

export const sanitizeTemplateSvg = (
  source: string,
  requestedWidth?: number,
  requestedHeight?: number,
) => {
  if (!source.trim()) throw new Error("SVG source is empty.");
  if (embeddedImageDataUrlPattern.test(source)) {
    throw new Error(
      "SVG assets cannot contain embedded base64 images. Upload a pure vector SVG instead.",
    );
  }
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const parserError = document.querySelector("parsererror");
  const root = document.documentElement;
  if (parserError || root.localName.toLowerCase() !== "svg") {
    throw new Error("The SVG is not well-formed.");
  }

  document
    .querySelectorAll("script, foreignObject, iframe, object, embed")
    .forEach((element) => element.remove());
  document.querySelectorAll("style").forEach((element) => {
    element.textContent = String(element.textContent || "")
      .replace(/@import[^;]+;/gi, "")
      .replace(/url\(\s*(['"]?)(?:https?:|\/\/)[^)]+\)/gi, "none");
  });
  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (
        (name === "href" || name === "xlink:href") &&
        !value.startsWith("#")
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (/url\(\s*(['"]?)(?:https?:|\/\/)/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  const dimensions = svgDimensions(root, requestedWidth, requestedHeight);
  root.setAttribute("width", String(dimensions.width));
  root.setAttribute("height", String(dimensions.height));
  if (!root.getAttribute("xmlns")) {
    root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  return {
    source: new XMLSerializer().serializeToString(document),
    ...dimensions,
  };
};

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be decoded."));
    image.src = url;
  });

const canvasToPng = (
  canvas: HTMLCanvasElement,
): Promise<{ dataUrl: string; byteSize: number }> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The image could not be converted to PNG."));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () =>
        reject(new Error("The converted PNG could not be read."));
      reader.onload = () =>
        resolve({
          dataUrl: String(reader.result || ""),
          byteSize: blob.size,
        });
      reader.readAsDataURL(blob);
    }, "image/png");
  });

const rasterizeUrl = async (
  url: string,
  width?: number,
  height?: number,
  pixelScale = 1,
) => {
  const image = await loadImage(url);
  const dimensions = fitDimensions(
    width || image.naturalWidth || image.width || 512,
    height || image.naturalHeight || image.height || 512,
    pixelScale,
  );
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    ...dimensions,
    ...(await canvasToPng(canvas)),
  };
};

const pngName = (name: string) => {
  const cleaned = String(name || "template-image")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\.(svg|png|jpe?g|webp)$/i, "");
  return `${cleaned || "template-image"}.png`;
};

const safeRasterName = (name: string, mimeType: "image/png" | "image/jpeg") => {
  const extension = mimeType === "image/jpeg" ? "jpg" : "png";
  const cleaned = String(name || `template-image.${extension}`)
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\.(svg|png|jpe?g|webp)$/i, "");
  return `${cleaned || "template-image"}.${extension}`;
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });

const svgName = (name: string) => {
  const cleaned = String(name || "template-image")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\.(svg|png|jpe?g|webp)$/i, "");
  return `${cleaned || "template-image"}.svg`;
};

export const svgSourceToTemplateImageAsset = (
  name: string,
  svg: string,
  options: {
    width?: number;
    height?: number;
    source?: TemplateImageAsset["source"];
  } = {},
): TemplateImageAsset => {
  const sanitized = sanitizeTemplateSvg(svg, options.width, options.height);
  return makeTemplateImageAsset({
    name: svgName(name),
    kind: "svg",
    mimeType: "image/svg+xml",
    originalMimeType: "image/svg+xml",
    source: options.source || "ai_svg",
    width: sanitized.width,
    height: sanitized.height,
    byteSize: new Blob([sanitized.source], {
      type: "image/svg+xml",
    }).size,
    svgSource: sanitized.source,
  });
};

export const rasterizeTemplateSvg = async (
  svg: string,
  width?: number,
  height?: number,
) => {
  const sanitized = sanitizeTemplateSvg(svg, width, height);
  const renderDimensions = fitTemplateImageDimensions(
    sanitized.width,
    sanitized.height,
    SVG_RENDER_SCALE,
  );
  const renderSvg = sanitizeTemplateSvg(
    sanitized.source,
    renderDimensions.width,
    renderDimensions.height,
  );
  const blobUrl = URL.createObjectURL(
    new Blob([renderSvg.source], { type: "image/svg+xml" }),
  );
  try {
    return await rasterizeUrl(
      blobUrl,
      renderDimensions.width,
      renderDimensions.height,
    );
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
};

export const fileToTemplateImageAsset = async (
  file: File,
): Promise<TemplateImageAsset> => {
  if (
    file.type === "image/svg+xml" ||
    file.name.toLowerCase().endsWith(".svg")
  ) {
    return svgSourceToTemplateImageAsset(file.name, await file.text(), {
      source: "upload",
    });
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error(`${file.name} must be SVG, PNG, JPEG, or WebP.`);
  }
  const blobUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(blobUrl);
    if (file.type === "image/png" || file.type === "image/jpeg") {
      const mimeType = file.type as "image/png" | "image/jpeg";
      return makeTemplateImageAsset({
        name: safeRasterName(file.name, mimeType),
        kind: "raster",
        mimeType,
        originalMimeType: mimeType,
        source: "upload",
        width: image.naturalWidth || image.width || 1,
        height: image.naturalHeight || image.height || 1,
        byteSize: file.size,
        dataUrl: await fileToDataUrl(file),
      });
    }
    const converted = await rasterizeUrl(
      blobUrl,
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
    );
    return makeTemplateImageAsset({
      name: pngName(file.name),
      kind: "raster",
      mimeType: "image/png",
      originalMimeType: file.type,
      source: "upload",
      width: converted.width,
      height: converted.height,
      byteSize: converted.byteSize,
      dataUrl: converted.dataUrl,
    });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
};

export const templateImagePreviewUrl = (asset: TemplateImageAsset) =>
  asset.kind === "svg" && asset.svgSource
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.svgSource)}`
    : asset.dataUrl || "";

export const templateImageSnippet = (asset: TemplateImageAsset) =>
  `<img src="${asset.placeholder}" />`;

export const embeddedImageDataUrlPattern = /data:image\/[a-z0-9.+-]+;base64,/i;
