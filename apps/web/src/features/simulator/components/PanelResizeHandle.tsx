import { type CSSProperties, type ReactElement, useEffect, useRef, useState } from "react";

type PanelResizeHandleProps = Readonly<{
  label: string;
  width: number;
  minimum: number;
  maximum: number;
  defaultWidth: number;
  direction: "left" | "right";
  onResize: (width: number) => void;
  className: string;
  style: CSSProperties;
}>;

/** Pointer captureで境界の外までドラッグできる。左右キー・Home/Endでも調整可能。 */
export const PanelResizeHandle = ({
  label,
  width,
  minimum,
  maximum,
  defaultWidth,
  direction,
  onResize,
  className,
  style,
}: PanelResizeHandleProps): ReactElement => {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const sign = direction === "right" ? 1 : -1;
  const resize = (value: number): void => onResize(Math.max(minimum, Math.min(maximum, value)));
  const finish = (): void => {
    drag.current = null;
    setDragging(false);
  };

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [dragging]);

  return (
    <hr
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={width}
      aria-valuetext={`${width}ピクセル`}
      tabIndex={0}
      title="ドラッグまたは左右キーで幅を変更。ダブルクリックで元に戻す。"
      className={`absolute inset-y-0 z-40 m-0 h-auto w-2 touch-none cursor-col-resize select-none border-0 hover:bg-accent/20 focus-visible:bg-accent/20 focus-visible:outline-none ${dragging ? "bg-accent/20" : ""} ${className}`}
      style={style}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) {
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, width };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || event.pointerId !== start.pointerId) {
          return;
        }
        resize(start.width + (event.clientX - start.x) * sign);
      }}
      onPointerUp={(event) => {
        if (event.pointerId !== drag.current?.pointerId) {
          return;
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        finish();
      }}
      onPointerCancel={(event) => {
        if (event.pointerId === drag.current?.pointerId) {
          finish();
        }
      }}
      onLostPointerCapture={(event) => {
        if (event.pointerId === drag.current?.pointerId) {
          finish();
        }
      }}
      onDoubleClick={() => resize(defaultWidth)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 16;
        switch (event.key) {
          case "ArrowLeft":
            resize(width - step * sign);
            break;
          case "ArrowRight":
            resize(width + step * sign);
            break;
          case "Home":
            resize(minimum);
            break;
          case "End":
            resize(maximum);
            break;
          default:
            return;
        }
        event.preventDefault();
      }}
    />
  );
};
