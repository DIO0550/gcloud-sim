/**
 * 要素の大きさの変化を購読する（ResizeObserver のラップ）。
 * window の resize だけでは、レイアウトの切り替えで要素だけが縮んだときに気づけない。
 */
export const ElementSize = {
  /**
   * @param element 大きさを見張る要素
   * @param onChange 大きさが変わるたびに呼ぶ
   * @returns 購読をやめる関数
   */
  observe(element: Element, onChange: () => void): () => void {
    const observer = new ResizeObserver(onChange);
    observer.observe(element);
    return () => observer.disconnect();
  },
} as const;
