"""Export demo A through repo preprocessing; never execute notebook cells.

Run from repo root: python -m backend.scripts.export_notebook_demo --help
"""

import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from backend.src.api.schemas.notebook_demo_schema import NotebookDemoContract
from backend.src.processors.notebook_demo_processor import NotebookDemoProcessor
from backend.src.services.ingestion_service import IngestionService


def compare_reference(contract: NotebookDemoContract, reference_path: Path) -> None:
    """Notebook export is an oracle, not an input to the repo's feature calculation."""
    reference = json.loads(reference_path.read_text(encoding="utf-8"))
    if reference["source"]["sha256"] != contract.source.sha256:
        raise ValueError("Reference and input asset checksums differ")
    for key, plan in contract.global_plans.items():
        for got, expected in zip(plan, reference["events_by_pollutant"][key], strict=True):
            for field in ("value", "score"):
                actual = getattr(got.scientific, field)
                target = expected["scientific"][field]
                if actual is None or target is None:
                    if actual != target:
                        raise ValueError(f"Missing mismatch: {key}/{field}")
                elif not np.isclose(actual, target, rtol=1e-10, atol=1e-12):
                    raise ValueError(f"Notebook mismatch: {key}/{got.scientific.scan_id}/{field}: {actual} vs {target}")
            for field in ("pulses", "valid_cells", "total_cells", "scan_id"):
                if getattr(got.scientific, field) != expected["scientific"][field]:
                    raise ValueError(f"Scientific event mismatch: {key}/{field}")
            for field in ("artistic_mood", "chord_name", "chord_midi", "melody_midi", "bass_midi", "melody_note_count", "delta_canonical_score"):
                if getattr(got, field) != expected[field]:
                    raise ValueError(f"Frozen plan mismatch: {key}/{got.scientific.scan_id}/{field}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, required=True)
    parser.add_argument("--source-url", help="Explicit NASA URL required for nasa mode")
    parser.add_argument("--data-mode", choices=("nasa", "synthetic"), required=True)
    parser.add_argument("--reference", type=Path, help="Optional notebook JSON oracle; export fails on disagreement")
    parser.add_argument("--output", type=Path, default=Path("frontend/public/data/notebook-demo"))
    args = parser.parse_args()
    checksum = IngestionService.calculate_sha256(args.file)
    contract, fields = NotebookDemoProcessor.build(
        args.file, checksum, is_mock=args.data_mode == "synthetic", source_url=args.source_url,
    )
    if args.reference:
        compare_reference(contract, args.reference)
        print("PASS: 192 events match notebook values, pulses, quality counts and frozen music plans")
    args.output.mkdir(parents=True, exist_ok=True)
    for key, field in fields.items():
        # Fixed georeferenced extent; no labels, padding, or crop on the web map.
        fig = plt.figure(figsize=(12, 6), dpi=120)
        ax = fig.add_axes((0, 0, 1, 1))
        ax.set_facecolor("#070b14")
        ax.pcolormesh(field.lon, field.lat, field.values, cmap="viridis", vmin=0,
                      vmax=contract.pollutants[key].display_max, shading="auto", rasterized=True)
        ax.set(xlim=(-180, 180), ylim=(-90, 90))
        ax.set_axis_off()
        fig.savefig(args.output / f"{key}.png", facecolor="#070b14")
        plt.close(fig)
    path = args.output / "contract.json"
    path.write_text(contract.model_dump_json(indent=2), encoding="utf-8")
    print(f"Exported validated {contract.schema_version}: {path}; isMock={contract.isMock}")


if __name__ == "__main__":
    main()
