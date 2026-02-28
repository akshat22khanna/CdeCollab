from fastapi import FastAPI
from pydantic import BaseModel
from typing import List

app = FastAPI(title="CodeCollab ML Service")

class AnalyzeRequest(BaseModel):
    code: str
    language: str = "javascript"

class AnalyzeResponse(BaseModel):
    complexity: str
    complexity_score: int
    quality_score: int
    bugs: List[str]
    suggestions: List[str]
    hint: str


def estimate_complexity(code: str) -> str:
    loops = code.count("for") + code.count("while")
    nested_signal = "for" in code and "for" in code[code.find("for") + 1 :]
    if loops == 0:
        return "O(1)"
    if nested_signal or loops >= 3:
        return "O(n^2)"
    return "O(n)"


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest):
    code = payload.code or ""
    complexity = estimate_complexity(code)
    bugs = []
    suggestions = []

    if "==" in code and payload.language in {"javascript", "typescript"}:
        bugs.append("Prefer strict equality (`===`) over loose equality (`==`).")
    if "console.log" in code:
        suggestions.append("Remove debug logs before final submission.")
    if "TODO" in code:
        bugs.append("Unfinished TODO markers found.")
    if "for" in code and "break" not in code:
        suggestions.append("Consider early-exit conditions to reduce unnecessary iterations.")

    complexity_score = 95 if complexity == "O(1)" else 80 if complexity == "O(n)" else 60
    quality_score = max(40, 92 - (len(bugs) * 12))

    hint = "Focus on edge cases and explain tradeoffs aloud."
    if complexity == "O(n^2)":
        hint = "You have nested iteration. Try a hash map or two-pointer strategy."
    elif complexity == "O(n)":
        hint = "Good linear scan. Check if memory usage can be reduced."

    if not bugs:
        bugs = ["No major bug pattern detected."]
    if not suggestions:
        suggestions = ["Add comments for non-obvious logic and include input validation."]

    return AnalyzeResponse(
        complexity=complexity,
        complexity_score=complexity_score,
        quality_score=quality_score,
        bugs=bugs,
        suggestions=suggestions,
        hint=hint,
    )
