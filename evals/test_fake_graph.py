import pytest
from fake_graph import transition


def test_recording_flow():
    status = "created"
    for event in ("start", "submit", "complete"):
        status = transition(status, event)
    assert status == "ready"


def test_invalid_transition():
    with pytest.raises(ValueError):
        transition("ready", "submit")
