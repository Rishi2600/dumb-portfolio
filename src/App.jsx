import CursorGlow from "./components/ui/CursorGlow";
import ScrollRail from "./components/layout/ScrollRail";
import Nav from "./components/layout/Nav";
import Footer from "./components/layout/Footer";
import Hero from "./components/sections/Hero";
import About from "./components/sections/About";
import Skills from "./components/sections/Skills";
import Projects from "./components/sections/Projects";
import Contact from "./components/sections/Contact";
import { useTheme } from "./hooks/useTheme";

export default function App() {
  const { theme, toggleTheme, isDark } = useTheme();

  return (
    <>
      <ScrollRail />

      <div className="relative z-10">
        <Nav theme={theme} onToggleTheme={toggleTheme} />
        <Hero isDark={isDark} />

        {/* The hero stays pinned; everything after it rides on a sheet
            that slides up over the glass (see .page-sheet). */}
        <div className="page-sheet">
          <div className="page-sheet-glow">
            <CursorGlow />
          </div>
          <div className="relative z-10">
            <About />
            <Skills />
            <Projects />
            <Contact />
            <Footer />
          </div>
        </div>
      </div>
    </>
  );
}
