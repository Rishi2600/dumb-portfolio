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
      <div className="scene-bg" />
      <CursorGlow />
      <ScrollRail />

      <div className="relative z-10">
        <Nav theme={theme} onToggleTheme={toggleTheme} />
        <Hero isDark={isDark} />
        <About />
        <Skills />
        <Projects />
        <Contact />
        <Footer />
      </div>
    </>
  );
}
