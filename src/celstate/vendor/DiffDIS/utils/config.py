import os
from pathlib import Path

DIS_DATA_ROOT = Path(
    os.environ.get(
        "DIFFDIS_DIS_DATA_ROOT",
        Path(__file__).resolve().parent / ".." / "data" / "DIS5K",
    )
).resolve()

diste1 = str(DIS_DATA_ROOT / "DIS-TE1")
diste2 = str(DIS_DATA_ROOT / "DIS-TE2")
diste3 = str(DIS_DATA_ROOT / "DIS-TE3")
diste4 = str(DIS_DATA_ROOT / "DIS-TE4")
disvd = str(DIS_DATA_ROOT / "DIS-VD")
