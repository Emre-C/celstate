"""Vendored DiffDIS wrapper and utilities for Celstate."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Optional, Tuple

import numpy as np
from PIL import Image
import torch
import torch.nn.functional as F

from .utils.image_util import resize_max_res

DEFAULT_MODEL_ID = "qianyu1217/diffdis"
DEFAULT_TTA_SCALES = (0.75, 1.0, 1.25)


class DiffDISWrapper:
    """Thin wrapper around the vendored DiffDIS pipeline."""

    def __init__(
        self,
        model_id: str = DEFAULT_MODEL_ID,
        unet_id: Optional[str] = None,
        device: Optional[torch.device | str] = None,
        torch_dtype: Optional[torch.dtype] = None,
    ) -> None:
        self.model_id = model_id
        self.unet_id = unet_id or model_id
        self.device = self._resolve_device(device)
        self.torch_dtype = torch_dtype
        self._pipe = None

    @staticmethod
    def _resolve_device(device: Optional[torch.device | str]) -> torch.device:
        if device is not None:
            return torch.device(device)
        if torch.cuda.is_available():
            return torch.device("cuda")
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return torch.device("mps")
        return torch.device("cpu")

    @staticmethod
    def _vendor_diffusers_path() -> Path:
        return Path(__file__).resolve().parent / "diffusers-0.30.2" / "src"

    @classmethod
    def _ensure_vendor_diffusers(cls) -> None:
        diffusers_src = cls._vendor_diffusers_path()
        if diffusers_src.exists():
            diffusers_path = str(diffusers_src)
            if diffusers_path not in sys.path:
                sys.path.insert(0, diffusers_path)

    def load(self):
        if self._pipe is not None:
            return self._pipe

        self._ensure_vendor_diffusers()

        from diffusers import AutoencoderKL, DDPMScheduler, UNet2DConditionModel_diffdis
        from transformers import CLIPTextModel, CLIPTokenizer

        from .core.diffdis_pipeline import DiffDISPipeline

        vae = AutoencoderKL.from_pretrained(self.model_id, subfolder="vae")
        scheduler = DDPMScheduler.from_pretrained(self.model_id, subfolder="scheduler")
        text_encoder = CLIPTextModel.from_pretrained(self.model_id, subfolder="text_encoder")
        tokenizer = CLIPTokenizer.from_pretrained(self.model_id, subfolder="tokenizer")
        unet = UNet2DConditionModel_diffdis.from_pretrained(
            self.unet_id,
            subfolder="unet",
            in_channels=8,
            sample_size=96,
            low_cpu_mem_usage=False,
            ignore_mismatched_sizes=False,
            class_embed_type="projection",
            projection_class_embeddings_input_dim=4,
            mid_extra_cross=True,
            mode="DBIA",
            use_swci=True,
        )

        pipe = DiffDISPipeline(
            unet=unet,
            vae=vae,
            scheduler=scheduler,
            text_encoder=text_encoder,
            tokenizer=tokenizer,
        )
        if self.torch_dtype is None:
            pipe = pipe.to(self.device)
        else:
            pipe = pipe.to(device=self.device, dtype=self.torch_dtype)

        self._pipe = pipe
        return pipe

    def predict(
        self,
        image: Image.Image,
        denoise_steps: int = 1,
        ensemble_size: int = 1,
        processing_res: int = 1024,
        match_input_res: bool = True,
        batch_size: int = 0,
        show_progress_bar: bool = False,
        use_tta: bool = False,
        tta_scales: tuple[float, ...] = DEFAULT_TTA_SCALES,
        tta_horizontal_flip: bool = True,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        pipe = self.load()

        original_size = image.size
        if processing_res and processing_res > 0:
            image = resize_max_res(image, processing_res)

        rgb = np.asarray(image.convert("RGB"))
        rgb = np.transpose(rgb, (2, 0, 1))
        rgb_norm = rgb / 255.0 * 2.0 - 1.0
        input_dtype = self.torch_dtype or torch.float32
        rgb_tensor = torch.from_numpy(rgb_norm).to(
            device=self.device,
            dtype=input_dtype,
        ).unsqueeze(0)

        if not use_tta:
            mask, edge = pipe(
                rgb_tensor,
                denosing_steps=denoise_steps,
                ensemble_size=ensemble_size,
                processing_res=processing_res,
                match_input_res=match_input_res,
                batch_size=batch_size,
                show_progress_bar=show_progress_bar,
            )
            mask = self._resize_output(mask, original_size)
            edge = self._resize_output(edge, original_size)
            return mask, edge

        if not tta_scales:
            raise ValueError("tta_scales must contain at least one scale value.")

        base_hw = rgb_tensor.shape[-2:]
        flip_options = [False, True] if tta_horizontal_flip else [False]
        mask_accum = None
        edge_accum = None
        tta_count = 0
        for scale in tta_scales:
            if scale <= 0:
                raise ValueError(f"Invalid tta scale: {scale}. Must be > 0.")
            if scale == 1.0:
                scaled_tensor = rgb_tensor
            else:
                scaled_tensor = F.interpolate(
                    rgb_tensor,
                    scale_factor=scale,
                    mode="bilinear",
                    align_corners=False,
                )
            for do_flip in flip_options:
                aug_tensor = torch.flip(scaled_tensor, dims=[3]) if do_flip else scaled_tensor
                mask, edge = pipe(
                    aug_tensor,
                    denosing_steps=denoise_steps,
                    ensemble_size=ensemble_size,
                    processing_res=processing_res,
                    match_input_res=match_input_res,
                    batch_size=batch_size,
                    show_progress_bar=show_progress_bar,
                )
                mask = self._deaugment_prediction(mask, do_flip, base_hw)
                edge = self._deaugment_prediction(edge, do_flip, base_hw)
                if mask_accum is None:
                    mask_accum = mask
                    edge_accum = edge
                else:
                    mask_accum = mask_accum + mask
                    edge_accum = edge_accum + edge
                tta_count += 1

        if tta_count == 0:
            raise ValueError("No TTA predictions were produced.")

        mask = mask_accum / tta_count
        edge = edge_accum / tta_count
        mask = self._resize_output(mask, original_size)
        edge = self._resize_output(edge, original_size)
        return mask, edge

    @staticmethod
    def _deaugment_prediction(
        tensor: torch.Tensor,
        flipped: bool,
        target_hw: tuple[int, int],
    ) -> torch.Tensor:
        working = DiffDISWrapper._ensure_4d(tensor)
        if flipped:
            working = torch.flip(working, dims=[3])
        if working.shape[-2:] != target_hw:
            working = F.interpolate(
                working,
                size=target_hw,
                mode="bilinear",
                align_corners=False,
            )
        return working.squeeze(0).squeeze(0)

    @staticmethod
    def _ensure_4d(tensor: torch.Tensor) -> torch.Tensor:
        if tensor.ndim == 2:
            return tensor.unsqueeze(0).unsqueeze(0)
        if tensor.ndim == 3:
            return tensor.unsqueeze(0)
        return tensor

    @staticmethod
    def _resize_output(tensor: torch.Tensor, size: Tuple[int, int]) -> torch.Tensor:
        width, height = size
        if tensor.ndim == 2:
            tensor = tensor.unsqueeze(0).unsqueeze(0)
        elif tensor.ndim == 3:
            tensor = tensor.unsqueeze(0)
        if tensor.shape[-2:] != (height, width):
            tensor = F.interpolate(
                tensor,
                size=(height, width),
                mode="bilinear",
                align_corners=False,
            )
        return tensor.squeeze(0).squeeze(0).detach().float().cpu()


__all__ = ["DiffDISWrapper"]
