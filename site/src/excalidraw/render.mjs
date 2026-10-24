import rough from 'roughjs';

// Renders an Excalidraw scene (.excalidraw JSON) to a static SVG string at
// build time, so pages ship no Excalidraw runtime. It follows Excalidraw's own
// rough.js options, so seeds and roughness give the same hand-drawn strokes.
// Text uses the site fonts instead of Excalidraw's handwriting fonts.

const generator = rough.generator();
const padding = 16;
const fonts = {
  sans: "'Inter Variable', system-ui, sans-serif",
  mono: "'JetBrains Mono Variable', ui-monospace, monospace",
};
const supported = new Set(['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'text']);
const arrowheads = new Set(['arrow', 'triangle']);
// Excalidraw's Code fonts: Cascadia (3, older scenes) and Comic Shanns (8).
const monoFamilies = new Set([3, 8]);

const round = (value) => Math.round(value * 100) / 100;
const escape = (text) => String(text)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function roughOptions(element) {
  const solid = element.strokeStyle === 'solid' || !element.strokeStyle;
  const width = element.strokeWidth ?? 2;
  const options = {
    seed: element.seed ?? 1,
    roughness: element.roughness ?? 1,
    stroke: element.strokeColor ?? '#1e1e1e',
    strokeWidth: solid ? width : width + 0.5,
    disableMultiStroke: !solid,
    fillWeight: width / 2,
    hachureGap: width * 4,
    preserveVertices: (element.roughness ?? 1) < 2,
  };
  if (element.strokeStyle === 'dashed') options.strokeLineDash = [8, 8 + width];
  if (element.strokeStyle === 'dotted') options.strokeLineDash = [1.5, 6 + width];
  if (element.backgroundColor && element.backgroundColor !== 'transparent') {
    options.fill = element.backgroundColor;
    options.fillStyle = element.fillStyle ?? 'hachure';
  }
  return options;
}

// Excalidraw's adaptive corner radius (roundness type 3) and its older
// proportional radius (type 2).
function cornerRadius(element) {
  const size = Math.min(element.width, element.height);
  if (!element.roundness) return 0;
  if (element.roundness.type === 3) {
    const fixed = element.roundness.value ?? 32;
    return size <= fixed / 0.25 ? size * 0.25 : fixed;
  }
  return size * 0.25;
}

function arrowhead(points, kind, atStart, width) {
  if (!kind || points.length < 2) return [];
  const [tip, from] = atStart ? [points[0], points[1]] : [points.at(-1), points.at(-2)];
  const length = Math.hypot(tip[0] - from[0], tip[1] - from[1]);
  if (!length) return [];
  const size = Math.min(kind === 'arrow' ? 20 : 14, length / 2) + width;
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const spread = (kind === 'arrow' ? 25 : 30) * Math.PI / 180;
  const wing = (side) => [
    tip[0] - size * Math.cos(angle + side * spread),
    tip[1] - size * Math.sin(angle + side * spread),
  ];
  return kind === 'arrow' ? [{lines: [wing(1), tip, wing(-1)]}] : [{polygon: [wing(1), tip, wing(-1)]}];
}

function shapes(element) {
  const {x, y, width: w, height: h} = element;
  const options = roughOptions(element);
  switch (element.type) {
    case 'rectangle': {
      const r = cornerRadius(element);
      if (!r) return [generator.rectangle(x, y, w, h, options)];
      return [generator.path(
        `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} ` +
        `Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} ` +
        `L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y}`, options)];
    }
    case 'diamond':
      return [generator.polygon([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]], options)];
    case 'ellipse':
      return [generator.ellipse(x + w / 2, y + h / 2, w, h, {...options, curveFitting: 1})];
    case 'line':
    case 'arrow': {
      const points = element.points.map(([px, py]) => [x + px, y + py]);
      const closed = element.type === 'line' && points.length > 2 &&
        points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
      const body = closed ? generator.polygon(points, options)
        : element.roundness && points.length > 2 ? generator.curve(points, {...options, fill: undefined})
          : generator.linearPath(points, {...options, fill: undefined});
      const heads = [
        ...arrowhead(points, element.startArrowhead, true, element.strokeWidth ?? 2),
        ...arrowhead(points, element.endArrowhead, false, element.strokeWidth ?? 2),
      ].map((head) => head.lines
        ? generator.linearPath(head.lines, {...options, fill: undefined, strokeLineDash: undefined})
        : generator.polygon(head.polygon, {...options, fill: options.stroke, fillStyle: 'solid', strokeLineDash: undefined}));
      return [body, ...heads];
    }
    default:
      return [];
  }
}

function pathMarkup(drawable) {
  return generator.toPaths(drawable).map((path) => {
    const dash = drawable.options.strokeLineDash;
    return `<path d="${path.d.replace(/-?\d+\.\d+/g, (n) => String(round(Number(n))))}" ` +
      `stroke="${escape(path.stroke)}" stroke-width="${round(path.strokeWidth)}" fill="${escape(path.fill ?? 'none')}"` +
      (dash && path.stroke !== 'none' ? ` stroke-dasharray="${dash.join(' ')}"` : '') +
      ' stroke-linecap="round" stroke-linejoin="round"/>';
  }).join('');
}

function textMarkup(element) {
  const lines = String(element.text ?? '').split('\n');
  const size = element.fontSize ?? 20;
  const lineHeight = size * (element.lineHeight ?? 1.25);
  const anchor = {left: 'start', center: 'middle', right: 'end'}[element.textAlign ?? 'left'];
  const tx = element.textAlign === 'center' ? element.x + element.width / 2
    : element.textAlign === 'right' ? element.x + element.width : element.x;
  const family = monoFamilies.has(element.fontFamily) ? fonts.mono : fonts.sans;
  return `<text font-family="${escape(family)}" font-size="${size}" fill="${escape(element.strokeColor ?? '#1e1e1e')}" ` +
    `text-anchor="${anchor}" dominant-baseline="central">` +
    lines.map((line, index) =>
      `<tspan x="${round(tx)}" y="${round(element.y + lineHeight * (index + 0.5))}">${escape(line)}</tspan>`).join('') +
    '</text>';
}

function freedrawMarkup(element) {
  const points = element.points.map(([px, py]) => `${round(element.x + px)},${round(element.y + py)}`).join(' ');
  return `<polyline points="${points}" fill="none" stroke="${escape(element.strokeColor ?? '#1e1e1e')}" ` +
    `stroke-width="${element.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// Unrotated box. For lines and arrows it surrounds the points, which can lie
// left of or above element.x and element.y.
function box(element) {
  if (element.points?.length) {
    const xs = element.points.map(([px]) => element.x + px);
    const ys = element.points.map(([, py]) => element.y + py);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return [element.x, element.y, element.x + element.width, element.y + element.height];
}

// Excalidraw rotates each element around the centre of its unrotated box.
function center(element) {
  const [x1, y1, x2, y2] = box(element);
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

function bounds(element) {
  const [x1, y1, x2, y2] = box(element);
  if (!element.angle) return [x1, y1, x2, y2];
  const [cx, cy] = center(element);
  const [cos, sin] = [Math.cos(element.angle), Math.sin(element.angle)];
  const corners = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map(([px, py]) =>
    [cx + (px - cx) * cos - (py - cy) * sin, cy + (px - cx) * sin + (py - cy) * cos]);
  const xs = corners.map(([px]) => px);
  const ys = corners.map(([, py]) => py);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Returns an SVG string for the scene. `title` labels the image for assistive
 * technology. Unsupported element types, such as images and frames, and
 * unsupported arrowheads throw so that a diagram never renders with silently
 * missing or changed parts.
 */
export function renderExcalidraw(scene, {title}) {
  if (scene?.type !== 'excalidraw' || !Array.isArray(scene.elements)) {
    throw new Error('Expected an Excalidraw scene with an elements array.');
  }
  const elements = scene.elements.filter((element) => !element.isDeleted);
  const unknown = elements.find((element) => !supported.has(element.type));
  if (unknown) throw new Error(`Excalidraw element type "${unknown.type}" is not supported.`);
  const head = elements.flatMap((element) => [element.startArrowhead, element.endArrowhead])
    .find((kind) => kind && !arrowheads.has(kind));
  if (head) throw new Error(`Excalidraw arrowhead "${head}" is not supported.`);
  if (!elements.length) throw new Error('The Excalidraw scene has no elements.');

  const extent = elements.map(bounds).reduce((a, b) =>
    [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  const [minX, minY] = [extent[0] - padding, extent[1] - padding];
  const [width, height] = [extent[2] - extent[0] + padding * 2, extent[3] - extent[1] + padding * 2];

  const body = elements.map((element) => {
    const markup = element.type === 'text' ? textMarkup(element)
      : element.type === 'freedraw' ? freedrawMarkup(element)
        : shapes(element).map(pathMarkup).join('');
    const attributes = [];
    if ((element.opacity ?? 100) < 100) attributes.push(`opacity="${element.opacity / 100}"`);
    if (element.angle) {
      const [cx, cy] = center(element);
      attributes.push(`transform="rotate(${round(element.angle * 180 / Math.PI)} ${round(cx)} ${round(cy)})"`);
    }
    return attributes.length ? `<g ${attributes.join(' ')}>${markup}</g>` : markup;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(minX)} ${round(minY)} ${round(width)} ${round(height)}" ` +
    `width="${round(width)}" height="${round(height)}" role="img" aria-label="${escape(title)}">` +
    `<title>${escape(title)}</title>${body}</svg>`;
}
