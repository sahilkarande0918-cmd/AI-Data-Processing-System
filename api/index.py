import json
import os
import urllib.request

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

try:
    from processor import compare, sweep
except ImportError:  # running from the repo root
    from api.processor import compare, sweep

app = FastAPI()


class RunIn(BaseModel):
    records: int = Field(10_000, ge=100, le=50_000)
    threads: int = Field(4, ge=1, le=16)
    workload: str = Field("cpu", pattern="^(cpu|io)$")


@app.post("/api/run")
def run(body: RunIn):
    return {
        **compare(body.records, body.threads, body.workload),
        "sweep": sweep(min(body.records, 10_000), body.workload),
    }


def gemini_key():
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"]
    for mod in ("_secrets", "api._secrets"):  # untracked file, bundled only in direct deploys
        try:
            return __import__(mod, fromlist=["GEMINI_API_KEY"]).GEMINI_API_KEY
        except ImportError:
            pass
    return None


@app.post("/api/analyze")
def analyze(result: dict):
    key = gemini_key()
    if not key:
        raise HTTPException(503, "GEMINI_API_KEY is not configured")
    slim = {k: result.get(k) for k in ("records", "threads", "workload", "speedup")}
    slim["single_ms"] = result.get("single", {}).get("ms")
    slim["multi_ms"] = result.get("multi", {}).get("ms")
    slim["thread_overhead_ms"] = result.get("multi", {}).get("overhead_ms")  # create+start+join of no-op threads
    slim["per_thread"] = [{k: t[k] for k in ("thread", "records", "busy_ms")} for t in result.get("multi", {}).get("threads", [])]
    slim["sweep"] = result.get("sweep")
    prompt = (
        "You are an operating-systems lab examiner. A Python program preprocessed student records for an ML pipeline, "
        "once on a single thread and once split across threads (threading module, CPython with the GIL). "
        "'cpu' workload = feature hashing (CPU-bound); 'io' workload = simulated feature-store reads (blocking I/O). thread_overhead_ms is the cost of creating, starting and joining the same number of threads doing no work. "
        f"Measured results: {json.dumps(slim)}\n\n"
        "Write a sharp analysis in 4 short paragraphs, plain text, no markdown headings, no bullet symbols: "
        "1) what the numbers show, 2) why (GIL, context switching, thread creation/join overhead, Amdahl's law), "
        "3) what the thread sweep reveals about diminishing returns, 4) what this means for a real AI/ML data pipeline "
        "(threads vs processes vs vectorised libraries). Quote the actual numbers. Under 220 words."
    )
    error = None
    for model in ("gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest", "gemini-3.5-flash-lite"):  # fall through on overload
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            data=json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode(),
            headers={"Content-Type": "application/json", "x-goog-api-key": key},
        )
        try:
            with urllib.request.urlopen(req, timeout=40) as resp:
                data = json.load(resp)
            return {"text": data["candidates"][0]["content"]["parts"][0]["text"], "model": model}
        except Exception as e:
            error = e
    raise HTTPException(502, f"Gemini request failed: {error}")
