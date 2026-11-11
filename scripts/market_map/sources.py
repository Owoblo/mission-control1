"""Versioned source registry. Discovery is separate from reuse permission."""
import json
from pathlib import Path

DEFAULT_REGISTRY = Path(__file__).parent / "config" / "sources.json"


def load_sources(path=None):
    data = json.loads(Path(path or DEFAULT_REGISTRY).read_text())
    rows = data.get("sources", []) if isinstance(data, dict) else data
    ids = [row["id"] for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate source IDs")
    for row in rows:
        if not row.get("source_url") or not row.get("rights_status"):
            raise ValueError("Sources require URL and explicit rights status")
    return rows


def eligible(source):
    if source.get("cost_model", "free") != "free":
        return False, "Paid data services are disabled"
    if source.get("rights_status") not in ("permitted", "licensed_open"):
        return False, "Bulk reuse permission has not been verified"
    if source.get("retrieval_status") not in ("accessible", "fixture", "manual_import", "ingested", "partially_ingested", "stale"):
        return False, "Source retrieval is not verified accessible"
    if not source.get("adapter_name"):
        return False, "No adapter configured"
    return True, None
