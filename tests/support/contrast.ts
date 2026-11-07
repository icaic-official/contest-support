import type { Locator } from "@playwright/test";

type Pixel = number[];

/**
 * Reads the text color and the opaque background that the browser paints for
 * an element. A canvas resolves any CSS color syntax, and it blends a
 * translucent text color or background over the ones below it. A color that
 * is still in a transition reads as a value between its ends, so the read
 * waits for the transitions and animations that end.
 */
async function paintedColors(
  locator: Locator,
): Promise<{ text: Pixel; background: Pixel }> {
  return locator.evaluate(async (element) => {
    const ending: Animation[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      ending.push(
        ...node
          .getAnimations()
          .filter((animation) =>
            Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
          ),
      );
    }
    await Promise.allSettled(ending.map((animation) => animation.finished));
    const context = document
      .createElement("canvas")
      .getContext("2d", { willReadFrequently: true })!;
    const read = () => Array.from(context.getImageData(0, 0, 1, 1).data);
    const backgrounds: string[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      backgrounds.push(getComputedStyle(node).backgroundColor);
    }
    for (const color of backgrounds.reverse()) {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
    }
    const background = read();
    context.fillStyle = getComputedStyle(element).color;
    context.fillRect(0, 0, 1, 1);
    return { text: read(), background };
  });
}

/** The WCAG contrast ratio of the text of an element against its background. */
export async function contrastOf(locator: Locator): Promise<number> {
  const { text, background } = await paintedColors(locator);
  const luminance = ([r, g, b]: Pixel) => {
    const linear = (value: number) => {
      const unit = value / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r!) + 0.7152 * linear(g!) + 0.0722 * linear(b!);
  };
  const [lighter, darker] = [luminance(text), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
}
