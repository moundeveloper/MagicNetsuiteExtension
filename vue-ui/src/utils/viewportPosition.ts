interface ViewportBoundedPositionOptions {
  margin?: number;
  offset?: number;
}

export const getViewportBoundedMenuPosition = (
  clientX: number,
  clientY: number,
  menuElement: HTMLElement,
  options: ViewportBoundedPositionOptions = {}
) => {
  const margin = options.margin ?? 8;
  const offset = options.offset ?? 6;
  const rect = menuElement.getBoundingClientRect();
  const width = rect.width || menuElement.offsetWidth;
  const height = rect.height || menuElement.offsetHeight;

  const maxX = window.innerWidth - width - margin;
  const maxY = window.innerHeight - height - margin;

  let x = clientX + offset;
  let y = clientY + offset;

  if (x > maxX) x = clientX - width - offset;
  if (y > maxY) y = clientY - height - offset;

  x = Math.min(Math.max(x, margin), Math.max(margin, maxX));
  y = Math.min(Math.max(y, margin), Math.max(margin, maxY));

  return { x, y };
};
