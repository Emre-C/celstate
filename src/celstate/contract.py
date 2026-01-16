"""Canonical interface contract helpers for Celstate."""

from typing import Optional

from celstate.interpreter import infer_asset_type

ALLOWED_ASSET_TYPES = {
    "container",
    "icon",
    "texture",
    "effect",
    "image",
    "decoration",
}


def validate_prompt(prompt: str) -> Optional[str]:
    if not prompt or not prompt.strip():
        return "prompt is required"
    if len(prompt) > 2000:
        return "prompt exceeds 2000 characters"
    return None


def validate_asset_type(asset_type: Optional[str]) -> Optional[str]:
    if asset_type is None:
        return None
    if asset_type not in ALLOWED_ASSET_TYPES:
        allowed = ", ".join(sorted(ALLOWED_ASSET_TYPES))
        return f"asset_type must be one of: {allowed}"
    return None


def validate_render_size_hint(render_size_hint: Optional[int]) -> Optional[str]:
    if render_size_hint is None:
        return None
    if not isinstance(render_size_hint, int):
        return "render_size_hint must be an integer"
    return None


def resolve_asset_type(asset_type: Optional[str], prompt: str) -> str:
    return asset_type or infer_asset_type(prompt)


def normalize_layout_intent(layout_intent: Optional[str]) -> str:
    return layout_intent or "auto"


def validate_job_create_request(
    prompt: str,
    asset_type: Optional[str],
    render_size_hint: Optional[int],
) -> Optional[str]:
    prompt_error = validate_prompt(prompt)
    if prompt_error:
        return prompt_error

    asset_type_error = validate_asset_type(asset_type)
    if asset_type_error:
        return asset_type_error

    render_hint_error = validate_render_size_hint(render_size_hint)
    if render_hint_error:
        return render_hint_error

    return None
