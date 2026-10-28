"""Deterministic sentence-sized units; no learner text accepted for synthesis."""
import re


def practice_sentences(text: str) -> list[str]:
    # Protect decimals and common abbreviations before finding end punctuation.
    protected = re.sub(r'(?<=\d)\.(?=\d)', '\u2024', text.strip())
    protected = re.sub(r'\b(?:Mr|Mrs|Ms|Dr|Prof|St|e\.g|i\.e)\.', lambda m:m.group().replace('.', '\u2024'), protected, flags=re.I)
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z0-9"\u201c])|\n+', protected)
    return [part.replace('\u2024','.').strip() for part in parts if part.strip()][:12]
