import { useEffect, useRef, useState } from "react";
import { ElementSize } from "@/libs/element-size";

type Panel = "left" | "right" | "console";
type Widths = Readonly<Record<Panel, number>>;
const limits = {
  left: { minimum: 200, maximum: 520, defaultWidth: 280 },
  right: { minimum: 280, maximum: 680, defaultWidth: 416 },
  console: { minimum: 200, maximum: 480, defaultWidth: 232 },
} as const;
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

/** 幅は表示切り替え後も保持し、ウィンドウが縮んだときは中央に320pxを残す。 */
export const usePanelWidths = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1440);
  const [preferred, setPreferred] = useState<Widths>({ left: 280, right: 416, console: 232 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const measure = (): void => {
      const width = Math.round(element.getBoundingClientRect().width);
      if (width > 0) {
        setContainerWidth(width);
      }
    };
    measure();
    return ElementSize.observe(element, measure);
  }, []);

  const budget = Math.max(limits.left.minimum + limits.right.minimum, containerWidth - 320);
  const left = clamp(
    preferred.left,
    limits.left.minimum,
    Math.min(limits.left.maximum, budget - limits.right.minimum),
  );
  const right = clamp(
    preferred.right,
    limits.right.minimum,
    Math.min(limits.right.maximum, budget - left),
  );
  const consoleMaximum = Math.max(
    limits.console.minimum,
    Math.min(limits.console.maximum, containerWidth - 320),
  );
  const widths: Widths = {
    left,
    right,
    console: clamp(preferred.console, limits.console.minimum, consoleMaximum),
  };
  const maximums: Widths = {
    left: Math.max(limits.left.minimum, Math.min(limits.left.maximum, budget - right)),
    right: Math.max(limits.right.minimum, Math.min(limits.right.maximum, budget - left)),
    console: consoleMaximum,
  };
  const panel = (name: Panel) => ({
    ...limits[name],
    width: widths[name],
    maximum: maximums[name],
    onResize: (width: number): void => {
      setPreferred((previous) => ({
        ...previous,
        [name]: clamp(width, limits[name].minimum, maximums[name]),
      }));
    },
  });
  return { containerRef, left: panel("left"), right: panel("right"), console: panel("console") };
};
