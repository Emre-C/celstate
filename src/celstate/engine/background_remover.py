"""DiffDIS-based background removal engine."""

from __future__ import annotations

from typing import Optional

import numpy as np
from PIL import Image
import torch

from celstate.vendor.DiffDIS import (
    DiffDISWrapper,
    DEFAULT_MODEL_ID,
    DEFAULT_TTA_SCALES,
)

DEFAULT_DENOISE_STEPS = 10
DEFAULT_ENSEMBLE_SIZE = 3
DEFAULT_PROCESSING_RES = 1024
DEFAULT_MATCH_INPUT_RES = True
DEFAULT_BATCH_SIZE = 0
DEFAULT_SHOW_PROGRESS_BAR = False
DEFAULT_USE_TTA = True
DEFAULT_TTA_HORIZONTAL_FLIP = True


class DiffDISModel:
    """Thin wrapper that converts DiffDIS predictions into RGBA output."""

    def __init__(
        self,
        model_id: str = DEFAULT_MODEL_ID,
        unet_id: Optional[str] = None,
        device: Optional[torch.device | str] = None,
        torch_dtype: Optional[torch.dtype] = None,
        denoise_steps: int = DEFAULT_DENOISE_STEPS,
        ensemble_size: int = DEFAULT_ENSEMBLE_SIZE,
        processing_res: int = DEFAULT_PROCESSING_RES,
        match_input_res: bool = DEFAULT_MATCH_INPUT_RES,
        batch_size: int = DEFAULT_BATCH_SIZE,
        show_progress_bar: bool = DEFAULT_SHOW_PROGRESS_BAR,
        use_tta: bool = DEFAULT_USE_TTA,
        tta_scales: tuple[float, ...] = DEFAULT_TTA_SCALES,
        tta_horizontal_flip: bool = DEFAULT_TTA_HORIZONTAL_FLIP,
    ) -> None:
        self.wrapper = DiffDISWrapper(
            model_id=model_id,
            unet_id=unet_id,
            device=device,
            torch_dtype=torch_dtype,
        )
        self.denoise_steps = denoise_steps
        self.ensemble_size = ensemble_size
        self.processing_res = processing_res
        self.match_input_res = match_input_res
        self.batch_size = batch_size
        self.show_progress_bar = show_progress_bar
        self.use_tta = use_tta
        self.tta_scales = tuple(tta_scales)
        self.tta_horizontal_flip = tta_horizontal_flip
        self._loaded = False

    def load_weights(self) -> None:
        """Preload DiffDIS weights into memory."""
        self.wrapper.load()
        self._loaded = True

    def predict_mask(
        self,
        image: Image.Image,
        *,
        denoise_steps: Optional[int] = None,
        ensemble_size: Optional[int] = None,
        processing_res: Optional[int] = None,
        match_input_res: Optional[bool] = None,
        batch_size: Optional[int] = None,
        show_progress_bar: Optional[bool] = None,
        use_tta: Optional[bool] = None,
        tta_scales: Optional[tuple[float, ...]] = None,
        tta_horizontal_flip: Optional[bool] = None,
    ) -> Image.Image:
        """Return a single-channel alpha mask (L mode)."""
        mask_tensor, _ = self._predict_tensors(
            image,
            denoise_steps=denoise_steps,
            ensemble_size=ensemble_size,
            processing_res=processing_res,
            match_input_res=match_input_res,
            batch_size=batch_size,
            show_progress_bar=show_progress_bar,
            use_tta=use_tta,
            tta_scales=tta_scales,
            tta_horizontal_flip=tta_horizontal_flip,
        )
        return self._tensor_to_alpha(mask_tensor)

    def predict(
        self,
        image: Image.Image,
        *,
        denoise_steps: Optional[int] = None,
        ensemble_size: Optional[int] = None,
        processing_res: Optional[int] = None,
        match_input_res: Optional[bool] = None,
        batch_size: Optional[int] = None,
        show_progress_bar: Optional[bool] = None,
        use_tta: Optional[bool] = None,
        tta_scales: Optional[tuple[float, ...]] = None,
        tta_horizontal_flip: Optional[bool] = None,
    ) -> Image.Image:
        """Return RGBA image with DiffDIS alpha applied."""
        mask_tensor, _ = self._predict_tensors(
            image,
            denoise_steps=denoise_steps,
            ensemble_size=ensemble_size,
            processing_res=processing_res,
            match_input_res=match_input_res,
            batch_size=batch_size,
            show_progress_bar=show_progress_bar,
            use_tta=use_tta,
            tta_scales=tta_scales,
            tta_horizontal_flip=tta_horizontal_flip,
        )
        alpha = self._tensor_to_alpha(mask_tensor)
        rgba = image.convert("RGBA")
        rgba.putalpha(alpha)
        return rgba

    def _predict_tensors(
        self,
        image: Image.Image,
        *,
        denoise_steps: Optional[int] = None,
        ensemble_size: Optional[int] = None,
        processing_res: Optional[int] = None,
        match_input_res: Optional[bool] = None,
        batch_size: Optional[int] = None,
        show_progress_bar: Optional[bool] = None,
        use_tta: Optional[bool] = None,
        tta_scales: Optional[tuple[float, ...]] = None,
        tta_horizontal_flip: Optional[bool] = None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        if not self._loaded:
            self.load_weights()
        resolved_tta_scales = self.tta_scales if tta_scales is None else tuple(tta_scales)
        return self.wrapper.predict(
            image=image,
            denoise_steps=self.denoise_steps if denoise_steps is None else denoise_steps,
            ensemble_size=self.ensemble_size if ensemble_size is None else ensemble_size,
            processing_res=self.processing_res if processing_res is None else processing_res,
            match_input_res=self.match_input_res if match_input_res is None else match_input_res,
            batch_size=self.batch_size if batch_size is None else batch_size,
            show_progress_bar=self.show_progress_bar if show_progress_bar is None else show_progress_bar,
            use_tta=self.use_tta if use_tta is None else use_tta,
            tta_scales=resolved_tta_scales,
            tta_horizontal_flip=self.tta_horizontal_flip if tta_horizontal_flip is None else tta_horizontal_flip,
        )

    @staticmethod
    def _tensor_to_alpha(mask_tensor: torch.Tensor) -> Image.Image:
        if mask_tensor.ndim == 3:
            mask_tensor = mask_tensor.squeeze(0)
        mask = torch.clamp(mask_tensor.detach().float().cpu(), 0.0, 1.0)
        alpha = (mask.numpy() * 255).astype(np.uint8)
        return Image.fromarray(alpha, mode="L")


__all__ = [
    "DiffDISModel",
    "DEFAULT_DENOISE_STEPS",
    "DEFAULT_ENSEMBLE_SIZE",
    "DEFAULT_PROCESSING_RES",
    "DEFAULT_MATCH_INPUT_RES",
    "DEFAULT_BATCH_SIZE",
    "DEFAULT_SHOW_PROGRESS_BAR",
    "DEFAULT_USE_TTA",
    "DEFAULT_TTA_SCALES",
    "DEFAULT_TTA_HORIZONTAL_FLIP",
]
