# Multithreaded AI Data Processing System

Operating Systems · Unit 2 (Process and Thread Management) · CO2
Sahil Karande · PRN 202501110194 · Division C · Batch C2 · Assignment 2

## Problem statement

Process a large dataset (10,000 student records by default) as parallel data preprocessing for an AI/ML pipeline. Run the task on a single thread, then divide the dataset among multiple threads, measure both, and explain the difference including thread-management overhead.

## OS concepts used

- **Threads vs processes:** all worker threads live in one process and share its address space, so they read the same record list without copying.
- **Thread lifecycle:** `Thread()` (new) → `start()` (runnable/running) → blocked on I/O or the GIL → returns (terminated) → `join()`.
- **Multithreading model:** CPython threads are one-to-one kernel threads; each log line shows the native thread id.
- **Synchronization:** each thread writes only its own result slot; the shared progress counter is updated under a `threading.Lock`.
- **Overhead:** thread creation, scheduling, context switches and GIL hand-offs. Measured separately as the create + start + join time of the same number of no-op threads.

## Approach

1. Generate `n` deterministic student records (5 subject marks, attendance, study hours).
2. Preprocessing per record: normalise features, compute mean / std-dev, assign a grade, flag at-risk students.
   - **CPU-bound mode:** adds feature hashing (60 SHA-256 rounds per record).
   - **I/O-bound mode:** adds a simulated feature-store read (4 ms blocking wait per 50 records).
3. **Single-threaded:** process all records in one loop, timed with `time.perf_counter()`.
4. **Multithreaded:** `split()` cuts the dataset into contiguous, near-equal chunks (remainders go to the first chunks), one `threading.Thread` per chunk; start all, join all, merge results.
5. Report per-thread range, record count, start / finish / busy time, total times, speedup, efficiency, and verify that both versions produce identical output.
6. A thread sweep (1, 2, 4, 8, 16 threads) shows diminishing returns; Gemini writes an analysis of the measured numbers.

Core logic: [`api/processor.py`](api/processor.py). API: [`api/index.py`](api/index.py). UI: [`frontend/src/App.jsx`](frontend/src/App.jsx).

## Test cases

| Case | Records | Threads | Workload | What it shows |
| --- | --- | --- | --- | --- |
| TC1 | 1,000 | 2 | CPU | Small dataset: overhead is a large share of the time |
| TC2 | 10,000 | 4 | CPU | GIL: no speedup for pure-Python computation |
| TC3 | 10,000 | 4 | I/O | Blocking waits overlap: close to 4× speedup |
| TC4 | 50,000 | 8 | I/O | Scaling with more data and threads |
| TC5 | 10,000 | 16 | CPU | Oversubscription: extra threads only add switching |

Every case is runnable from the Test cases section of the web app.

## Analysis in short

- **CPU-bound:** CPython's Global Interpreter Lock lets one thread execute bytecode at a time, so 4 threads take about as long as 1 (sometimes longer from context switching and GIL contention). True CPU parallelism needs processes (`multiprocessing`) or native libraries that release the GIL.
- **I/O-bound:** a thread blocked in a read releases the GIL, so waits overlap and wall time drops close to `1 / threads` until the serial parts (setup, merge, join) dominate — Amdahl's law.
- **Real world:** ML data loaders use thread pools for reading files and fetching features, and processes or vectorised code for heavy transforms.

## Run it

Console demo (evidence of execution, no dependencies):

```bash
python api/processor.py
```

Web app locally:

```bash
pip install fastapi uvicorn
python -m uvicorn index:app --app-dir api --port 8000
npm --prefix frontend install
npm --prefix frontend run dev
```

Set `GEMINI_API_KEY` in the environment (or in Vercel project settings) to enable the AI analysis.
