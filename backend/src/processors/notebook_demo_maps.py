"""Shared fixed-scale raster export for baseline A and local archive snapshots."""
from pathlib import Path
import xarray as xr
from ..api.schemas.notebook_demo_schema import NotebookDemoContract


def render_maps(contract: NotebookDemoContract, fields: dict[str, xr.DataArray], output: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    output.mkdir(parents=True, exist_ok=True)
    for key, field in fields.items():
        fig = plt.figure(figsize=(12, 6), dpi=120)
        ax = fig.add_axes((0, 0, 1, 1))
        ax.set_facecolor("#070b14")
        ax.pcolormesh(field.lon, field.lat, field.values, cmap="viridis", vmin=0,
                      vmax=contract.pollutants[key].display_max, shading="auto", rasterized=True)
        ax.set(xlim=(-180, 180), ylim=(-90, 90))
        ax.set_axis_off()
        fig.savefig(output / f"{key}.png", facecolor="#070b14")
        plt.close(fig)
