import { createRoot } from 'react-dom/client'
import Lenis from 'lenis'
import App from './App.jsx'
import './styles.css'

if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const lenis = new Lenis({ lerp: 0.09, anchors: true })
  const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf) }
  requestAnimationFrame(raf)
}

createRoot(document.getElementById('root')).render(<App />)
