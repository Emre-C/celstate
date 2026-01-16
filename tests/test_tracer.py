"""
Unit tests for the Tracer module.
"""

import json
import tempfile
import unittest
from pathlib import Path

from celstate.tracer import Tracer, Trace, TraceEvent


class TestTraceEvent(unittest.TestCase):
    """Tests for TraceEvent dataclass."""
    
    def test_trace_event_creation(self):
        """TraceEvent should store timestamp, event_type, and data."""
        event = TraceEvent(
            timestamp="2026-01-02T12:00:00",
            event_type="input",
            data={"prompt": "test"}
        )
        self.assertEqual(event.timestamp, "2026-01-02T12:00:00")
        self.assertEqual(event.event_type, "input")
        self.assertEqual(event.data, {"prompt": "test"})


class TestTrace(unittest.TestCase):
    """Tests for Trace dataclass."""
    
    def test_trace_to_dict(self):
        """Trace.to_dict() should return JSON-serializable dict."""
        trace = Trace(
            job_id="test-job-123",
            created_at="2026-01-02T12:00:00",
            duration_ms=1500
        )
        trace.events.append(TraceEvent(
            timestamp="2026-01-02T12:00:01",
            event_type="input",
            data={"prompt": "test prompt"}
        ))
        
        result = trace.to_dict()
        
        self.assertEqual(result["job_id"], "test-job-123")
        self.assertEqual(result["created_at"], "2026-01-02T12:00:00")
        self.assertEqual(result["duration_ms"], 1500)
        self.assertEqual(len(result["events"]), 1)
        self.assertEqual(result["events"][0]["event_type"], "input")
        
        # Should be JSON-serializable
        json_str = json.dumps(result)
        self.assertIn("test-job-123", json_str)


class TestTracer(unittest.TestCase):
    """Tests for Tracer class."""
    
    def test_record_single_event(self):
        """Tracer.record() should add events to the trace."""
        tracer = Tracer("job-abc")
        tracer.record("input", {"prompt": "hello"})
        
        self.assertEqual(len(tracer.trace.events), 1)
        self.assertEqual(tracer.trace.events[0].event_type, "input")
        self.assertEqual(tracer.trace.events[0].data["prompt"], "hello")
    
    def test_record_multiple_events(self):
        """Tracer should capture multiple events in order."""
        tracer = Tracer("job-multi")
        tracer.record("input", {"prompt": "test"})
        tracer.record("hf_request", {"model": "kimi"})
        tracer.record("hf_response", {"content": "interpreted"})
        tracer.record("output", {"status": "success"})
        
        self.assertEqual(len(tracer.trace.events), 4)
        self.assertEqual(tracer.trace.events[0].event_type, "input")
        self.assertEqual(tracer.trace.events[1].event_type, "hf_request")
        self.assertEqual(tracer.trace.events[2].event_type, "hf_response")
        self.assertEqual(tracer.trace.events[3].event_type, "output")
    
    def test_sanitize_bytes(self):
        """Bytes data should be sanitized to size description."""
        tracer = Tracer("job-bytes")
        tracer.record("test", {"image_data": b"fake image bytes"})
        
        self.assertIn("bytes", tracer.trace.events[0].data["image_data"])
        self.assertIn("16", tracer.trace.events[0].data["image_data"])
    
    def test_sanitize_path(self):
        """Path objects should be converted to strings."""
        tracer = Tracer("job-path")
        tracer.record("test", {"output_path": Path("/var/jobs/abc/out.png")})
        
        self.assertEqual(
            tracer.trace.events[0].data["output_path"],
            "/var/jobs/abc/out.png"
        )
    
    def test_finalize_writes_json(self):
        """Tracer.finalize() should write valid JSON to trace directory."""
        tracer = Tracer("job-finalize")
        tracer.record("input", {"prompt": "test"})
        tracer.record("output", {"status": "success"})
        
        with tempfile.TemporaryDirectory() as tmpdir:
            trace_path = tracer.finalize(Path(tmpdir))
            
            self.assertTrue(trace_path.exists())
            self.assertEqual(trace_path.name, "trace.json")
            
            with open(trace_path) as f:
                data = json.load(f)
            
            self.assertEqual(data["job_id"], "job-finalize")
            self.assertIsNotNone(data["duration_ms"])
            self.assertEqual(len(data["events"]), 2)
    
    def test_finalize_creates_directory(self):
        """Tracer.finalize() should create output directory if needed."""
        tracer = Tracer("job-mkdir")
        tracer.record("input", {})
        
        with tempfile.TemporaryDirectory() as tmpdir:
            nested_dir = Path(tmpdir) / "nested" / "trace"
            trace_path = tracer.finalize(nested_dir)
            
            self.assertTrue(nested_dir.exists())
            self.assertTrue(trace_path.exists())


if __name__ == '__main__':
    unittest.main()
