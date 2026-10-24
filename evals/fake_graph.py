"""Deterministic S1 state graph for offline regression checks."""

TRANSITIONS = {
    "created": {"start": "recording", "cancel": "cancelled"},
    "recording": {"submit": "processing", "cancel": "cancelled"},
    "processing": {"complete": "ready", "fail": "failed"},
    "failed": {"retry": "processing", "cancel": "cancelled"},
    "ready": {},
    "cancelled": {},
}


def transition(status: str, event: str) -> str:
    try:
        return TRANSITIONS[status][event]
    except KeyError as exc:
        raise ValueError(f"invalid transition: {status} + {event}") from exc
