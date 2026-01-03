"""
End-to-End Observability Tracer.

Captures structured traces of all API calls (HuggingFace, Gemini) for each
tool invocation, enabling debugging and performance analysis.
"""

import json
import os
import tempfile
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional


def _utcnow() -> datetime:
    """Return current UTC time (timezone-aware)."""
    return datetime.now(timezone.utc)


@dataclass
class TraceEvent:
    """A single event in a trace."""
    timestamp: str
    event_type: str  # "input", "hf_request", "hf_response", "gemini_request", "gemini_response", "output", "error"
    data: Dict[str, Any]


@dataclass
class Trace:
    """Complete trace of a job execution."""
    job_id: str
    created_at: str
    events: List[TraceEvent] = field(default_factory=list)
    duration_ms: Optional[int] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert trace to dictionary for JSON serialization."""
        return {
            "job_id": self.job_id,
            "created_at": self.created_at,
            "duration_ms": self.duration_ms,
            "events": [asdict(e) for e in self.events]
        }


class Tracer:
    """
    Collects structured trace events during job execution.
    
    Usage:
        tracer = Tracer(job_id)
        tracer.record("input", {"prompt": "...", ...})
        tracer.record("hf_request", {"messages": [...], ...})
        tracer.record("hf_response", {"content": "...", ...})
        tracer.record("gemini_request", {"prompt": "...", ...})
        tracer.record("gemini_response", {"status": "success", ...})
        tracer.record("output", {"component": {...}, ...})
        tracer.finalize(output_dir)
    """
    
    def __init__(self, job_id: str):
        """Initialize tracer for a specific job."""
        self.trace = Trace(
            job_id=job_id,
            created_at=_utcnow().isoformat()
        )
        self._start_time = _utcnow()
    
    def record(self, event_type: str, data: Dict[str, Any]) -> None:
        """
        Record a trace event.
        
        Args:
            event_type: Category of event (input, hf_request, hf_response, 
                        gemini_request, gemini_response, output, error)
            data: Event payload - should be JSON-serializable
        """
        event = TraceEvent(
            timestamp=_utcnow().isoformat(),
            event_type=event_type,
            data=self._sanitize_data(data)
        )
        self.trace.events.append(event)
    
    def _sanitize_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Sanitize data for JSON serialization.
        
        Converts non-serializable types and truncates large payloads.
        """
        sanitized = {}
        for key, value in data.items():
            if isinstance(value, bytes):
                # Don't store raw binary data, just note the size
                sanitized[key] = f"<bytes: {len(value)} bytes>"
            elif isinstance(value, Path):
                sanitized[key] = str(value)
            elif isinstance(value, (dict, list, str, int, float, bool, type(None))):
                sanitized[key] = value
            else:
                # Fallback: convert to string representation
                sanitized[key] = str(value)
        return sanitized
    
    def finalize(self, output_dir: Path) -> Path:
        """
        Finalize and write trace to disk.
        
        Args:
            output_dir: Directory to write trace.json
            
        Returns:
            Path to the written trace file
        """
        # Calculate duration
        self.trace.duration_ms = int(
            (_utcnow() - self._start_time).total_seconds() * 1000
        )
        
        # Ensure output directory exists
        output_dir.mkdir(parents=True, exist_ok=True)
        
        trace_file = output_dir / "trace.json"
        
        # Atomic write: write to temp file then rename
        with tempfile.NamedTemporaryFile("w", dir=output_dir, delete=False, suffix=".json") as tf:
            json.dump(self.trace.to_dict(), tf, indent=2)
            temp_name = tf.name
        
        try:
            os.replace(temp_name, trace_file)
        except Exception:
            if os.path.exists(temp_name):
                os.remove(temp_name)
            raise
        
        return trace_file
