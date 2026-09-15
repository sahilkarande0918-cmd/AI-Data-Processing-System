"""Multithreaded AI data preprocessing: single thread vs N threads over student records.

Run `python api/processor.py` for console evidence of execution.
"""
import hashlib
import math
import random
import threading
import time

SUBJECTS = ("os", "dsa", "maths", "ml", "dbms")


def make_dataset(n, seed=42):
    rng = random.Random(seed)
    return [
        {
            "id": i + 1,
            "marks": [rng.randint(20, 100) for _ in SUBJECTS],
            "attendance": rng.randint(40, 100),
            "study_hours": round(rng.uniform(0, 12), 1),
        }
        for i in range(n)
    ]


def preprocess(rec, workload):
    """One record through the ML preprocessing step: normalise, engineer features, label."""
    marks = rec["marks"]
    mean = sum(marks) / len(marks)
    std = math.sqrt(sum((m - mean) ** 2 for m in marks) / len(marks))
    features = [m / 100 for m in marks] + [rec["attendance"] / 100, rec["study_hours"] / 12]
    if workload == "cpu":
        # feature hashing: stands in for tokenising / embedding a record
        digest = str(features).encode()
        for _ in range(60):
            digest = hashlib.sha256(digest).digest()
    grade = "A" if mean >= 80 else "B" if mean >= 65 else "C" if mean >= 50 else "D"
    return {"mean": mean, "std": std, "grade": grade, "at_risk": rec["attendance"] < 60 and mean < 50}


IO_BATCH = 50  # records per simulated feature-store round trip
IO_LATENCY = 0.004  # seconds per round trip (network / disk read)


def process_chunk(records, workload):
    out = []
    for i, rec in enumerate(records):
        if workload == "io" and i % IO_BATCH == 0:
            time.sleep(IO_LATENCY)  # blocking I/O releases the GIL
        out.append(preprocess(rec, workload))
    return out


def summarize(results):
    grades = {g: 0 for g in "ABCD"}
    for r in results:
        grades[r["grade"]] += 1
    return {
        "records": len(results),
        "grades": grades,
        "at_risk": sum(r["at_risk"] for r in results),
        "class_mean": round(sum(r["mean"] for r in results) / max(len(results), 1), 3),
    }


def run_single(data, workload):
    t0 = time.perf_counter()
    results = process_chunk(data, workload)
    return {"ms": (time.perf_counter() - t0) * 1000, "summary": summarize(results)}


def split(n, parts):
    """Even contiguous ranges; the first n % parts chunks get one extra record."""
    size, extra = divmod(n, parts)
    ranges, start = [], 0
    for i in range(parts):
        end = start + size + (1 if i < extra else 0)
        ranges.append((start, end))
        start = end
    return ranges


def thread_overhead_ms(threads):
    """Pure create + start + join cost of N no-op threads: thread management with zero work."""
    t0 = time.perf_counter()
    pool = [threading.Thread(target=lambda: None) for _ in range(threads)]
    for t in pool:
        t.start()
    for t in pool:
        t.join()
    return (time.perf_counter() - t0) * 1000


def run_multi(data, workload, threads):
    ranges = split(len(data), threads)
    results = [None] * threads
    log = [None] * threads
    processed = {"count": 0}
    lock = threading.Lock()  # guards the shared progress counter
    t0 = time.perf_counter()

    def worker(idx, lo, hi):
        started = time.perf_counter()
        chunk = process_chunk(data[lo:hi], workload)
        results[idx] = chunk
        with lock:
            processed["count"] += len(chunk)
        finished = time.perf_counter()
        log[idx] = {
            "thread": threading.current_thread().name,
            "native_id": threading.get_native_id(),
            "range": [lo, hi],
            "records": len(chunk),
            "started_ms": (started - t0) * 1000,
            "finished_ms": (finished - t0) * 1000,
            "busy_ms": (finished - started) * 1000,
        }

    pool = [threading.Thread(target=worker, args=(i, lo, hi), name=f"worker-{i + 1}") for i, (lo, hi) in enumerate(ranges)]
    for t in pool:
        t.start()
    for t in pool:
        t.join()
    total_ms = (time.perf_counter() - t0) * 1000
    merged = [r for chunk in results for r in chunk]
    return {
        "ms": total_ms,
        "overhead_ms": thread_overhead_ms(threads),
        "threads": log,
        "processed": processed["count"],
        "summary": summarize(merged),
    }


def compare(records, threads, workload):
    data = make_dataset(records)
    single = run_single(data, workload)
    multi = run_multi(data, workload, threads)
    return {
        "records": records,
        "threads": threads,
        "workload": workload,
        "single": single,
        "multi": multi,
        "speedup": single["ms"] / multi["ms"],
        "consistent": single["summary"] == multi["summary"],
    }


def sweep(records, workload, counts=(1, 2, 4, 8, 16)):
    data = make_dataset(records)
    return [{"threads": c, "ms": run_multi(data, workload, c)["ms"]} for c in counts]


if __name__ == "__main__":
    assert split(10, 3) == [(0, 4), (4, 7), (7, 10)]
    for workload in ("cpu", "io"):
        r = compare(10_000, 4, workload)
        assert r["consistent"] and r["multi"]["processed"] == 10_000
        print(f"\n=== workload: {workload} · 10,000 records · 4 threads ===")
        for t in r["multi"]["threads"]:
            print(f"  {t['thread']:>9} (tid {t['native_id']}) records {t['range'][0]:>5}-{t['range'][1]:<5} "
                  f"done {t['records']:>5} in {t['busy_ms']:8.2f} ms")
        print(f"  single-threaded : {r['single']['ms']:9.2f} ms")
        print(f"  multithreaded   : {r['multi']['ms']:9.2f} ms  (bare thread overhead {r['multi']['overhead_ms']:.2f} ms)")
        print(f"  speedup         : {r['speedup']:.2f}x · results identical: {r['consistent']}")
