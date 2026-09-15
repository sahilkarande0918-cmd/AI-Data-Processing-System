import { useRef, useState } from 'react'
import { motion, MotionConfig, AnimatePresence, useScroll, useTransform } from 'framer-motion'

const fmt = (n) => Math.round(n).toLocaleString('en-IN')
const ms = (n) => `${n < 10 ? n.toFixed(2) : n.toFixed(1)} ms`
const ease = [0.16, 1, 0.3, 1]

const TESTS = [
  { id: 'TC1', records: 1000, threads: 2, workload: 'cpu', why: 'Small dataset: thread overhead is a large share of total time.' },
  { id: 'TC2', records: 10000, threads: 4, workload: 'cpu', why: 'CPU-bound preprocessing. The GIL lets one thread run bytecode at a time.' },
  { id: 'TC3', records: 10000, threads: 4, workload: 'io', why: 'I/O-bound preprocessing. Threads wait in parallel while blocked reads release the GIL.' },
  { id: 'TC4', records: 50000, threads: 8, workload: 'io', why: 'Larger dataset, more threads: does the speedup keep scaling?' },
  { id: 'TC5', records: 10000, threads: 16, workload: 'cpu', why: 'Oversubscription: more threads than useful work, pure switching cost.' },
]

const CONCEPTS = [
  { k: 'Process vs thread', v: 'A process owns an address space, open files and a PCB. Threads live inside it and share that memory, so all workers read the same record list without copying it.' },
  { k: 'Process Control Block', v: 'The kernel keeps PID, state, registers, memory maps and scheduling info per process. Each thread adds only a smaller control block: its own stack, program counter and registers.' },
  { k: 'Thread lifecycle', v: 'new → runnable on start() → running when scheduled → blocked on I/O or the GIL → terminated when the target returns. join() waits for termination.' },
  { k: 'Multithreading model', v: 'CPython threads map one-to-one onto kernel threads. The OS schedules each worker independently; the native thread id in the log proves they are real kernel threads.' },
  { k: 'Synchronization', v: 'Workers write to their own result slot, so no lock is needed there. The shared progress counter is updated under a mutex, avoiding a read-modify-write race.' },
  { k: 'Process vs thread in AI', v: 'Data loaders use threads for I/O (reading shards, fetching features) and processes or native libraries for CPU-heavy transforms, because the GIL serialises Python bytecode.' },
]

function Nav() {
  return (
    <header className="nav">
      <pre className="nav__line">
        <span className="prompt">&gt;</span> threadlab{' '}
        <a href="#console">--run</a> <a href="#results">--compare</a> <a href="#concepts">--explain</a> <a href="#tests">--tests</a>
        <span className="caret" aria-hidden="true">▮</span>
      </pre>
    </header>
  )
}

function Lanes() {
  return (
    <svg className="lanes" viewBox="0 0 520 360" role="img" aria-label="A dataset block splitting into eight worker threads">
      <rect x="8" y="40" width="70" height="280" className="lanes__src" />
      {Array.from({ length: 8 }, (_, i) => {
        const y = 58 + i * 35
        return (
          <g key={i}>
            <path d={`M78 ${180} C 150 180, 130 ${y}, 200 ${y} L 470 ${y}`} className="lanes__wire" />
            <text x="476" y={y + 4} className="lanes__label">T{i + 1}</text>
            {[0, 1, 2].map((p) => (
              <motion.rect
                key={p} y={y - 3} width="14" height="6" className="lanes__packet"
                initial={{ x: 200, opacity: 0 }}
                animate={{ x: [200, 456], opacity: [0, 1, 1, 0] }}
                transition={{ duration: 2.4 + (i % 3) * 0.5, delay: p * 0.9 + i * 0.12, repeat: Infinity, ease: 'linear' }}
              />
            ))}
          </g>
        )
      })}
    </svg>
  )
}

function Hero() {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const textY = useTransform(scrollYProgress, [0, 1], [0, 140])
  const artY = useTransform(scrollYProgress, [0, 1], [0, -90])
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0])
  return (
    <section className="hero" ref={ref}>
      <motion.div className="hero__text" style={{ y: textY, opacity: fade }}>
        <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease }}>
          Split the dataset. <span className="mark">Race</span> the threads.
        </motion.h1>
        <motion.p className="lede" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.8 }}>
          Ten thousand student records go through an ML preprocessing step twice: once on a single thread,
          once divided across worker threads. Every run below is measured live on the server, in Python.
        </motion.p>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="hero__cta">
          <a className="btn" href="#console">Open the console</a>
          <a className="link" href="#concepts">Read the OS concepts</a>
        </motion.div>
      </motion.div>
      <motion.div className="hero__art" style={{ y: artY }}>
        <Lanes />
      </motion.div>
    </section>
  )
}

function Field({ label, value, children }) {
  return (
    <label className="field">
      <span className="field__top"><span>{label}</span><output>{value}</output></span>
      {children}
    </label>
  )
}

function Console({ cfg, setCfg, run, busy, error }) {
  const set = (k) => (e) => setCfg({ ...cfg, [k]: e.target.type === 'range' ? +e.target.value : e.target.value })
  return (
    <section className="console" id="console">
      <div className="section-head">
        <h2>Configure a run</h2>
        <p>Pick the dataset size, how many threads to divide it across, and what kind of work each record needs.</p>
      </div>
      <div className="panel console__grid">
        <Field label="Records" value={fmt(cfg.records)}>
          <input type="range" min="1000" max="50000" step="1000" value={cfg.records} onChange={set('records')} />
        </Field>
        <Field label="Threads" value={cfg.threads}>
          <input type="range" min="1" max="16" value={cfg.threads} onChange={set('threads')} />
        </Field>
        <fieldset className="seg">
          <legend>Workload</legend>
          {[['cpu', 'CPU-bound', 'feature hashing'], ['io', 'I/O-bound', 'feature-store reads']].map(([v, t, s]) => (
            <label key={v} className={cfg.workload === v ? 'on' : ''}>
              <input type="radio" name="workload" value={v} checked={cfg.workload === v} onChange={set('workload')} />
              <b>{t}</b><small>{s}</small>
            </label>
          ))}
        </fieldset>
        <button className="btn btn--run" onClick={() => run()} disabled={busy} data-state={busy ? 'loading' : undefined}>
          {busy ? 'Running…' : 'Run comparison'}
        </button>
      </div>
      {error && <p className="error" role="alert">Run failed: {error}. Check the API is reachable and try again.</p>}
    </section>
  )
}

const reveal = { initial: { opacity: 0, y: 30 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-60px' }, transition: { duration: 0.7, ease } }

function Card({ title, children, className = '' }) {
  return (
    <motion.article className={`card ${className}`} {...reveal} whileHover={{ y: -6 }}>
      <h3>{title}</h3>
      {children}
    </motion.article>
  )
}

function Division({ r }) {
  return (
    <Card title="How the dataset was divided" className="span-2">
      <p className="muted">{fmt(r.records)} records → {r.threads} contiguous chunks, one per thread. Remainders go to the first chunks.</p>
      <div className="split">
        {r.multi.threads.map((t, i) => (
          <motion.div key={i} className="split__seg" style={{ flexGrow: t.records, '--mix': `${90 - (i % 4) * 18}%` }}
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: i * 0.05, duration: 0.6, ease }}>
            {r.threads <= 8 && <span>T{i + 1}</span>}
          </motion.div>
        ))}
      </div>
      <div className="table-wrap stack">
        <table>
          <thead><tr><th>Thread</th><th>Native id</th><th>Record range</th><th>Records</th><th>Busy</th><th>Share</th></tr></thead>
          <tbody>
            {r.multi.threads.map((t) => (
              <tr key={t.thread}>
                <td className="head">{t.thread}</td><td data-label="Native id">{t.native_id}</td><td data-label="Range">{fmt(t.range[0] + 1)}–{fmt(t.range[1])}</td>
                <td data-label="Records">{fmt(t.records)}</td><td data-label="Busy">{ms(t.busy_ms)}</td><td data-label="Share">{((t.records / r.records) * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Timeline({ r }) {
  const total = r.multi.ms
  const done = [...r.multi.threads].sort((a, b) => a.finished_ms - b.finished_ms)
  return (
    <Card title="Thread completion log" className="span-3">
      <p className="muted">Each bar spans start → finish inside the multithreaded run. Overlap means the threads were alive at the same time.</p>
      <div className="gantt">
        {r.multi.threads.map((t, i) => (
          <div className="gantt__row" key={t.thread}>
            <span>{t.thread}</span>
            <div className="gantt__track">
              <motion.i style={{ left: `${(t.started_ms / total) * 100}%`, width: `${Math.max((t.busy_ms / total) * 100, 0.6)}%` }}
                initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.1 + i * 0.04, duration: 0.7, ease }} />
            </div>
          </div>
        ))}
      </div>
      <ol className="log">
        {done.map((t, i) => (
          <motion.li key={t.thread} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.07 }}>
            <span className="log__t">[+{ms(t.finished_ms)}]</span> {t.thread} · tid {t.native_id} · records {fmt(t.range[0] + 1)}–{fmt(t.range[1])} · {fmt(t.records)} processed <span className="ok">done</span>
          </motion.li>
        ))}
        <li><span className="log__t">[join]</span> all {r.threads} threads joined · {fmt(r.multi.processed)} records counted under lock</li>
      </ol>
    </Card>
  )
}

function Timing({ r }) {
  const max = Math.max(r.single.ms, r.multi.ms)
  const faster = r.speedup >= 1.05, slower = r.speedup <= 0.95
  const rows = [['1 thread', r.single.ms, 'single'], [`${r.threads} threads`, r.multi.ms, 'multi']]
  return (
    <Card title="Execution time" className="span-2 timing">
      <div className="bars">
        {rows.map(([label, v, cls]) => (
          <div className="bars__row" key={cls}>
            <span>{label}</span>
            <div className="bars__track"><motion.i className={cls} initial={{ width: 0 }} animate={{ width: `${(v / max) * 100}%` }} transition={{ duration: 0.9, ease }} /></div>
            <b>{ms(v)}</b>
          </div>
        ))}
      </div>
      <dl className="stats">
        <div><dt>Speedup</dt><dd>{r.speedup.toFixed(2)}×</dd></div>
        <div><dt>Efficiency</dt><dd>{((r.speedup / r.threads) * 100).toFixed(0)}%</dd></div>
        <div><dt>Bare thread overhead</dt><dd>{ms(r.multi.overhead_ms)}</dd></div>
        <div><dt>Outputs identical</dt><dd>{r.consistent ? 'yes' : 'no'}</dd></div>
      </dl>
      <p className="verdict">
        {faster && `${r.threads} threads finished ${r.speedup.toFixed(2)}× faster. `}
        {slower && `${r.threads} threads were ${(1 / r.speedup).toFixed(2)}× slower than one. `}
        {!faster && !slower && `No meaningful difference between one thread and ${r.threads}. `}
        {r.workload === 'cpu'
          ? 'This work is pure Python computation, so the GIL lets only one thread execute bytecode at a time; the extra threads add switching and lock hand-off instead of parallelism.'
          : 'Most of this work is waiting on blocking reads. A sleeping thread releases the GIL, so the waits overlap and wall-clock time drops close to 1 / threads.'}
      </p>
    </Card>
  )
}

function Sweep({ r }) {
  const max = Math.max(...r.sweep.map((s) => s.ms))
  const best = r.sweep.reduce((a, b) => (b.ms < a.ms ? b : a))
  return (
    <Card title="Thread sweep" className="sweep">
      <p className="muted">Same work, {fmt(Math.min(r.records, 10000))} records, 1 → 16 threads, milliseconds.</p>
      <div className="cols">
        {r.sweep.map((s, i) => (
          <div className={`cols__c ${s === best ? 'best' : ''}`} key={s.threads}>
            <small>{s.ms.toFixed(s.ms < 100 ? 1 : 0)}</small>
            <motion.i initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: i * 0.08, duration: 0.7, ease }} style={{ height: `${(s.ms / max) * 100}%` }} />
            <span>{s.threads}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Output({ r }) {
  const s = r.multi.summary
  return (
    <Card title="Processed output" className="output">
      <p className="muted">Grades after preprocessing. Both versions must agree record for record.</p>
      <dl className="grades">
        {Object.entries(s.grades).map(([g, n]) => <div key={g}><dt>{g}</dt><dd>{fmt(n)}</dd></div>)}
        <div><dt>At risk</dt><dd>{fmt(s.at_risk)}</dd></div>
        <div><dt>Class mean</dt><dd>{s.class_mean.toFixed(1)}</dd></div>
      </dl>
    </Card>
  )
}

function AiAnalysis({ r }) {
  const [state, setState] = useState({ busy: false, text: '', error: '', for: null })
  const stale = state.for !== r
  const ask = async () => {
    setState({ busy: true, text: '', error: '', for: r })
    try {
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || res.statusText)
      setState({ busy: false, text: data.text, error: '', for: r })
    } catch (e) {
      setState({ busy: false, text: '', error: e.message, for: r })
    }
  }
  return (
    <Card title="AI performance analysis" className="span-3 ai">
      <p className="muted">Gemini reads the measured numbers from this exact run and explains them.</p>
      {(stale || (!state.text && !state.busy)) && <button className="btn btn--ghost" onClick={ask}>{state.error && !stale ? 'Try again' : 'Analyse this run'}</button>}
      {!stale && state.busy && <p className="thinking">Reading the timings<span className="caret">▮</span></p>}
      {!stale && state.error && <p className="error" role="alert">Analysis failed: {state.error}</p>}
      {!stale && state.text && (
        <div className="ai__text">
          {state.text.split(/\n\s*\n/).map((p, i) => (
            <motion.p key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.15 }}>{p}</motion.p>
          ))}
        </div>
      )}
    </Card>
  )
}

function Results({ r }) {
  return (
    <section className="results" id="results">
      <div className="section-head">
        <h2>{fmt(r.records)} records · {r.threads} threads · {r.workload === 'cpu' ? 'CPU‑bound' : 'I/O‑bound'}</h2>
      </div>
      <div className="grid">
        <Timing r={r} />
        <Sweep r={r} />
        <Division r={r} />
        <Output r={r} />
        <Timeline r={r} />
        <AiAnalysis r={r} />
      </div>
    </section>
  )
}

function Concepts() {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const a = useTransform(scrollYProgress, [0, 1], [60, -60])
  const b = useTransform(scrollYProgress, [0, 1], [-20, 20])
  return (
    <section className="concepts" id="concepts" ref={ref}>
      <div className="section-head">
        <h2>What the operating system is doing</h2>
        <p>Unit 2, process and thread management, mapped onto the code that produced the numbers above.</p>
      </div>
      <div className="concepts__cols">
        {[a, b].map((y, col) => (
          <motion.div key={col} style={{ y }} className="concepts__col">
            {CONCEPTS.filter((_, i) => i % 2 === col).map((c) => (
              <motion.article key={c.k} className="card concept" whileHover={{ y: -6 }} {...reveal}>
                <h3>{c.k}</h3><p>{c.v}</p>
              </motion.article>
            ))}
          </motion.div>
        ))}
      </div>
      <div className="why">
        <motion.div {...reveal}><h3>Thread-management overhead</h3><p>Creating a thread asks the kernel for a stack and a control block; starting it adds a scheduling decision; joining waits for it. Each hand-off of the GIL forces a context switch. On small or CPU-bound workloads this fixed cost can exceed the work saved.</p></motion.div>
        <motion.div {...reveal}><h3>Diminishing returns</h3><p>Amdahl’s law caps speedup at 1 / (serial share + parallel share / threads). Dataset generation, merging chunks and joining stay serial, so doubling threads never doubles speed, and past the useful point more threads only add switching.</p></motion.div>
        <motion.div {...reveal}><h3>In a real ML pipeline</h3><p>Preprocessing loaders use thread pools to read files and fetch features concurrently, then hand heavy numeric transforms to multiple processes or to vectorised native code that releases the GIL.</p></motion.div>
      </div>
    </section>
  )
}

function Tests({ load, busy }) {
  return (
    <section className="tests" id="tests">
      <div className="section-head">
        <h2>Test cases</h2>
        <p>Each case isolates one effect. Load it to run it live.</p>
      </div>
      <div className="table-wrap stack panel">
        <table>
          <thead><tr><th>Case</th><th>Records</th><th>Threads</th><th>Workload</th><th>What it shows</th><th></th></tr></thead>
          <tbody>
            {TESTS.map((t) => (
              <tr key={t.id}>
                <td className="head">{t.id}</td><td data-label="Records">{fmt(t.records)}</td><td data-label="Threads">{t.threads}</td><td data-label="Workload">{t.workload === 'cpu' ? 'CPU' : 'I/O'}</td><td className="wrap full">{t.why}</td>
                <td className="full"><button className="btn btn--small" disabled={busy} onClick={() => load(t)}>Run</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function App() {
  const [cfg, setCfg] = useState({ records: 10000, threads: 4, workload: 'cpu' })
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (c = cfg) => {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail ? JSON.stringify(data.detail) : res.statusText)
      setResult(data)
      requestAnimationFrame(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' }))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <Nav />
      <main>
        <Hero />
        <Console cfg={cfg} setCfg={setCfg} run={run} busy={busy} error={error} />
        <AnimatePresence>{result && <Results key={`${result.records}-${result.threads}-${result.workload}-${result.single.ms}`} r={result} />}</AnimatePresence>
        <Concepts />
        <Tests busy={busy} load={(t) => { const c = { records: t.records, threads: t.threads, workload: t.workload }; setCfg(c); run(c) }} />
      </main>
      <footer className="foot">
        <p className="foot__statement">One dataset, many threads, and an honest stopwatch.</p>
        <p className="foot__meta">Sahil Karande · PRN 202501110194 · Division C · Batch C2 · Operating Systems · Assignment 2</p>
      </footer>
    </MotionConfig>
  )
}
