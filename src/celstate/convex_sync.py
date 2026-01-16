from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)


class ConvexSyncError(RuntimeError):
    """Raised when Convex synchronization fails in strict mode."""


class ConvexSyncConfigurationError(ConvexSyncError):
    """Raised when Convex sync is enabled but configuration is invalid."""


@dataclass(frozen=True)
class ConvexSyncConfig:
    enabled: bool
    convex_url: Optional[str]
    strict: bool
    upload_timeout_seconds: int

    @classmethod
    def from_env(cls) -> "ConvexSyncConfig":
        raw_enabled = os.getenv("CONVEX_SYNC_ENABLED", "auto")
        convex_url = os.getenv("CONVEX_URL")
        enabled = _parse_enabled(raw_enabled, convex_url)
        strict = _parse_bool(os.getenv("CONVEX_SYNC_STRICT"), default=True)
        timeout = _parse_int(os.getenv("CONVEX_UPLOAD_TIMEOUT_SECONDS"), default=30)
        return cls(
            enabled=enabled,
            convex_url=convex_url,
            strict=strict,
            upload_timeout_seconds=timeout,
        )


class ConvexSync:
    """
    Synchronize JobStore data and assets to Convex.

    Behavior is environment driven:
    - CONVEX_URL: Convex deployment URL (required when enabled)
    - CONVEX_SYNC_ENABLED: true/false/auto (auto enables if CONVEX_URL is set)
    - CONVEX_SYNC_STRICT: true/false (default true when enabled)
    - CONVEX_UPLOAD_TIMEOUT_SECONDS: request timeout for uploads
    """

    def __init__(
        self,
        config: Optional[ConvexSyncConfig] = None,
        client: Optional["ConvexClient"] = None,
    ) -> None:
        self.config = config or ConvexSyncConfig.from_env()
        self._client: Optional["ConvexClient"] = client

        if self.config.enabled and not self.config.convex_url:
            raise ConvexSyncConfigurationError(
                "CONVEX_URL is required when CONVEX_SYNC_ENABLED is true."
            )

    @property
    def enabled(self) -> bool:
        return self.config.enabled

    @property
    def strict(self) -> bool:
        return self.config.strict

    def upsert_job(self, job: Dict[str, Any]) -> None:
        if not self.enabled:
            return
        payload = _build_job_payload(job)
        try:
            client = self._get_client()
            client.mutation("jobs:upsert", payload)
        except Exception as exc:
            raise ConvexSyncError(f"Convex job upsert failed: {exc}") from exc

    def upload_asset(
        self,
        job_id: str,
        path: Path,
        role: str,
        content_type: str,
    ) -> str:
        if not self.enabled:
            return ""
        if not path.exists():
            raise ConvexSyncError(f"Asset missing on disk: {path}")

        try:
            client = self._get_client()
            upload_url = client.mutation("assets:generateUploadUrl")
        except Exception as exc:
            raise ConvexSyncError(f"Convex upload URL failed: {exc}") from exc

        try:
            with path.open("rb") as handle:
                response = requests.post(
                    upload_url,
                    data=handle,
                    headers={"Content-Type": content_type},
                    timeout=self.config.upload_timeout_seconds,
                )
            response.raise_for_status()
            payload = response.json()
            storage_id = payload.get("storageId")
            if not storage_id:
                raise ConvexSyncError(
                    f"Upload response missing storageId: {payload}"
                )
        except (requests.RequestException, ValueError) as exc:
            raise ConvexSyncError(f"Convex upload failed: {exc}") from exc

        try:
            client.mutation(
                "assets:save",
                {
                    "jobId": job_id,
                    "role": role,
                    "filename": path.name,
                    "storageId": storage_id,
                    "contentType": content_type,
                    "bytes": path.stat().st_size,
                },
            )
        except Exception as exc:
            raise ConvexSyncError(f"Convex asset save failed: {exc}") from exc

        return storage_id

    def _get_client(self) -> "ConvexClient":
        if self._client is None:
            from convex import ConvexClient

            self._client = ConvexClient(self.config.convex_url)
        return self._client


def _build_job_payload(job: Dict[str, Any]) -> Dict[str, Any]:
    created_at = _iso_to_epoch_ms(job.get("created_at"))
    updated_at = _iso_to_epoch_ms(job.get("updated_at"))
    return {
        "jobId": job["id"],
        "status": job["status"],
        "progressStage": job["progress_stage"],
        "prompt": job["prompt"],
        "styleContext": job["style_context"],
        "name": job["name"],
        "layoutIntent": job.get("layout_intent", "auto"),
        "renderSizeHint": job.get("render_size_hint"),
        "internalAssetType": job["type"],
        "component": job.get("component"),
        "telemetry": job.get("telemetry"),
        "error": job.get("error"),
        "retryAfter": job.get("retry_after"),
        "createdAt": created_at,
        "updatedAt": updated_at,
    }


def _iso_to_epoch_ms(value: Optional[str]) -> int:
    now_ms = int(time.time() * 1000)
    if not value:
        return now_ms
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        logger.warning("Invalid ISO timestamp for Convex sync: %s", value)
        return now_ms
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)


def _parse_bool(value: Optional[str], default: bool) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    raise ConvexSyncConfigurationError(
        f"Invalid boolean value for Convex sync config: {value}"
    )


def _parse_enabled(value: str, convex_url: Optional[str]) -> bool:
    normalized = value.strip().lower()
    if normalized in {"", "auto"}:
        return bool(convex_url)
    return _parse_bool(value, default=False)


def _parse_int(value: Optional[str], default: int) -> int:
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ConvexSyncConfigurationError(
            f"Invalid integer for Convex sync config: {value}"
        ) from exc
    if parsed <= 0:
        raise ConvexSyncConfigurationError(
            f"Invalid integer for Convex sync config: {value}"
        )
    return parsed
