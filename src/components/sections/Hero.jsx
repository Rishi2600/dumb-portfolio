import { ArrowUpRight } from "lucide-react";
import Reveal from "../ui/Reveal";
import { useMagnetic } from "../../hooks/useMagnetic";

export default function Hero() {
  const workBtn = useMagnetic();
  const contactBtn = useMagnetic();

  return (
    <section id="top" className="relative min-h-[100svh] flex items-end overflow-hidden">
      {/* Drag here to tilt the glass scene (see SceneBackground). The text
          lets pointer events through to it; only the buttons catch them. */}
      <div id="glass-drag" className="glass-drag absolute inset-0" />
      <div className="relative max-w-6xl mx-auto px-6 md:px-10 pb-24 pt-40 w-full pointer-events-none">
        <Reveal className="font-mono text-xs uppercase tracking-[0.25em] mb-6" style={{ color: "var(--clay)" }}>
          Full-stack developer — {new Date().getFullYear()}
        </Reveal>
        <Reveal delay={1}>
          <h1 className="font-display leading-[0.98] text-[13vw] md:text-[6.2vw] tracking-tight max-w-4xl">
            Hi, I'm{" "}
            <em className="italic" style={{ color: "var(--amber-deep)" }}>
              Rishi
            </em>
            .
            <br />I build full products — from the schema to the last pixel.
          </h1>
        </Reveal>
        <Reveal delay={2} className="mt-10 flex flex-wrap gap-4 pointer-events-auto">
          <a
            ref={workBtn.ref}
            onMouseMove={workBtn.onMouseMove}
            onMouseLeave={workBtn.onMouseLeave}
            href="#work"
            className="btn-primary magnetic"
          >
            See my work
            <ArrowUpRight size={16} strokeWidth={2.25} />
          </a>
          <a
            ref={contactBtn.ref}
            onMouseMove={contactBtn.onMouseMove}
            onMouseLeave={contactBtn.onMouseLeave}
            href="#contact"
            className="btn-outline magnetic"
          >
            Get in touch
          </a>
        </Reveal>
      </div>
    </section>
  );
}
