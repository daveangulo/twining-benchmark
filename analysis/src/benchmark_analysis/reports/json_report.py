"""JSON report generator for benchmark analysis results."""
from __future__ import annotations

import json
from pathlib import Path
from datetime import datetime

import numpy as np


class _NumpyEncoder(json.JSONEncoder):
    """JSON encoder that handles numpy types and other non-serializable objects."""

    def default(self, obj):
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            if np.isnan(obj) or np.isinf(obj):
                return None
            return float(obj)
        if isinstance(obj, (np.bool_,)):
            return bool(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, (datetime,)):
            return obj.isoformat()
        if isinstance(obj, Path):
            return str(obj)
        if hasattr(obj, "model_dump"):
            return obj.model_dump()
        if hasattr(obj, "__dataclass_fields__"):
            from dataclasses import asdict
            return asdict(obj)
        return super().default(obj)


def generate_json_report(results: dict, output_path: Path) -> None:
    """Write analysis results as structured JSON.

    Handles numpy types, NaN/Inf values, and Path objects gracefully.

    Args:
        results: Dictionary of analysis results from all dimensions.
        output_path: Path to write the JSON file.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Pre-process to replace NaN/Inf in plain floats
    cleaned = _clean_for_json(results)

    with open(output_path, "w") as f:
        json.dump(cleaned, f, indent=2, cls=_NumpyEncoder)


def _clean_for_json(obj):
    """Recursively clean an object for JSON serialization."""
    # Handle Pydantic BaseModel objects
    if hasattr(obj, "model_dump"):
        return _clean_for_json(obj.model_dump())
    # Handle dataclasses
    if hasattr(obj, "__dataclass_fields__"):
        from dataclasses import asdict
        return _clean_for_json(asdict(obj))
    if isinstance(obj, dict):
        return {k: _clean_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean_for_json(v) for v in obj]
    if isinstance(obj, float):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return obj
    if isinstance(obj, (np.floating,)):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return _clean_for_json(obj.tolist())
    if isinstance(obj, Path):
        return str(obj)
    return obj
