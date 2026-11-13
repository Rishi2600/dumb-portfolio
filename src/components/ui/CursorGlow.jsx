import { useEffect, useRef } from "react";

/**
 * A soft warm glow that eases toward the cursor. Sits between the page
 * sheet's background and its content, so it shows through the blurred
 * cards as you move — a lightweight way to make the whole page feel
 * like it's responding to you, not just the hero. It's positioned inside
 * its parent layer (.page-sheet-glow), which clips it to the sheet.
 */
export default function CursorGlow() {
  const ref = useRef(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return; // skip on touch

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let x = targetX;
    let y = targetY;

    const onMove = (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
    };
    window.addEventListener("mousemove", onMove);

    let frameId;
    const animate = () => {
      x += (targetX - x) * 0.08;
      y += (targetY - y) * 0.08;
      if (ref.current) {
        // the cursor is in viewport coordinates; the glow sits in its layer
        const layer = ref.current.parentElement.getBoundingClientRect();
        ref.current.style.transform = `translate(${x - layer.left}px, ${y - layer.top}px)`;
      }
      frameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(frameId);
    };
  }, []);

  return <div ref={ref} className="cursor-glow" aria-hidden="true" />;
}
