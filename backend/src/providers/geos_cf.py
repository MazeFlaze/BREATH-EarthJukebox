import hashlib
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional
import httpx
import pandas as pd

from .base import BaseNasaProvider
from ..utils.logger import logger


class GEOSCFProvider(BaseNasaProvider):
    """
    NASA GMAO GEOS-CF Version 2 Analysis Provider Adapter.
    Retrieves authentic hourly atmospheric composition model runs from the NCCS public archive.
    """

    DEFAULT_PORTAL_URL = "https://portal.nccs.nasa.gov/datashare/gmao/geos-cf/v2/ana"
    DEFAULT_PRODUCT = "aqc_tavg_1hr_glo_L1440x721_slv"
    DATASET_ID = "geos-cf-v2-aqc"

    VARIABLES = {
        "PM25_RH35": {
            "name": "Particulate Matter (PM2.5)",
            "unit": "ug m-3",
            "display_unit": "µg/m³",
            "description": "Particulate matter with aerodynamic diameter <= 2.5 µm at RH 35% mass concentration in dry air",
            "type": "mass_concentration"
        },
        "PM10_RH35": {
            "name": "Particulate Matter (PM10)",
            "unit": "ug m-3",
            "display_unit": "µg/m³",
            "description": "Particulate matter with aerodynamic diameter <= 10 µm at RH 35% mass concentration in dry air",
            "type": "mass_concentration"
        },
        "CO": {
            "name": "Carbon Monoxide (CO)",
            "unit": "mol mol-1",
            "display_unit": "mol/mol",
            "description": "Carbon monoxide mole fraction in dry air (MW=28.01 g/mol)",
            "type": "mole_fraction"
        },
        "NO2": {
            "name": "Nitrogen Dioxide (NO2)",
            "unit": "mol mol-1",
            "display_unit": "mol/mol",
            "description": "Nitrogen dioxide mole fraction in dry air (MW=46.01 g/mol)",
            "type": "mole_fraction"
        },
        "O3": {
            "name": "Ozone (O3)",
            "unit": "mol mol-1",
            "display_unit": "mol/mol",
            "description": "Tropospheric ozone mole fraction in dry air (MW=48.00 g/mol)",
            "type": "mole_fraction"
        },
        "SO2": {
            "name": "Sulfur Dioxide (SO2)",
            "unit": "mol mol-1",
            "display_unit": "mol/mol",
            "description": "Sulfur dioxide mole fraction in dry air (MW=64.04 g/mol)",
            "type": "mole_fraction"
        },
    }

    def __init__(
        self,
        portal_url: Optional[str] = None,
        product: Optional[str] = None,
        raw_storage_dir: Optional[Path] = None,
        timeout_seconds: int = 60,
        max_retries: int = 3,
    ):
        self.portal_url = (portal_url or self.DEFAULT_PORTAL_URL).rstrip("/")
        self.product = product or self.DEFAULT_PRODUCT
        if raw_storage_dir is None:
            raw_storage_dir = Path(__file__).resolve().parent.parent / "data" / "raw"
        self.raw_storage_dir = raw_storage_dir
        self.raw_storage_dir.mkdir(parents=True, exist_ok=True)
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries

    def get_source_metadata(self) -> Dict[str, Any]:
        """Returns GMAO GEOS-CF v2 metadata."""
        return {
            "datasetId": self.DATASET_ID,
            "provider": "NASA GMAO",
            "product": self.product,
            "productVersion": "v2",
            "dataType": "model_analysis",
            "spatialResolution": "0.25x0.25 (L1440x721)",
            "temporalResolution": "1hr (hourly time-averaged)",
            "sourceUrl": self.portal_url,
            "citation": "Keller, C. A., et al. (2021). Description of the NASA GEOS Composition Forecast (GEOS-CF) v1.0. ESSD.",
            "isMock": False,
        }

    def list_variables(self) -> Dict[str, Dict[str, Any]]:
        """Returns catalog of supported GEOS-CF atmospheric variables."""
        return self.VARIABLES

    def format_granule_filename(self, dt: datetime) -> str:
        """
        Constructs standard GMAO GEOS-CF filename for a given datetime.
        GEOS.cf.ana.aqc_tavg_1hr_glo_L1440x721_slv.YYYYMMDD_HH30z.R0.nc4
        """
        date_str = dt.strftime("%Y%m%d")
        hour_str = dt.strftime("%H")
        return f"GEOS.cf.ana.{self.product}.{date_str}_{hour_str}30z.R0.nc4"

    def build_remote_url(self, dt: datetime) -> str:
        """
        Constructs full NCCS DataShare remote URL.
        Example: .../Y2026/M11/D13/GEOS.cf.ana.aqc_tavg_1hr_glo_L1440x721_slv.20261113_0130z.R0.nc4
        """
        year_str = dt.strftime("%Y")
        month_str = dt.strftime("%m")
        day_str = dt.strftime("%d")
        filename = self.format_granule_filename(dt)
        return f"{self.portal_url}/Y{year_str}/M{month_str}/D{day_str}/{filename}"

    def list_available_times(self) -> List[str]:
        """
        Scans local raw storage for already-downloaded GEOS-CF granules and returns sorted ISO timestamps.
        """
        times = []
        for file in self.raw_storage_dir.glob("GEOS.cf.ana.*.nc4"):
            # Parse timestamp from filename: .YYYYMMDD_HH30z.
            parts = file.name.split(".")
            for part in parts:
                if len(part) == 14 and part[8] == "_" and part.endswith("z"):
                    try:
                        dt = datetime.strptime(part, "%Y%m%d_%H%Mz").replace(tzinfo=timezone.utc)
                        times.append(dt.strftime("%Y-%m-%dT%H:%M:%SZ"))
                    except ValueError:
                        pass
        return sorted(list(set(times)))

    def fetch_granule(self, timestamp: str, target_dir: Optional[Path] = None) -> Path:
        """
        Downloads authentic NetCDF granule from NASA NCCS DataShare if not already present.
        Validates SHA256, uses atomic write (.tmp -> .nc4), and retries with backoff.
        """
        dt = pd.to_datetime(timestamp, utc=True).to_pydatetime()
        filename = self.format_granule_filename(dt)
        dest_dir = target_dir or self.raw_storage_dir
        dest_dir.mkdir(parents=True, exist_ok=True)
        final_path = dest_dir / filename

        # Return existing file if valid size (>1MB)
        if final_path.exists() and final_path.stat().st_size > 1024 * 1024:
            logger.info(f"Using cached local GEOS-CF file: {final_path}")
            return final_path

        remote_url = self.build_remote_url(dt)
        temp_path = dest_dir / f"{filename}.tmp"
        logger.info(f"Fetching NASA GEOS-CF granule from: {remote_url}")

        last_error = None
        for attempt in range(1, self.max_retries + 1):
            try:
                sha256 = hashlib.sha256()
                with httpx.Client(timeout=self.timeout_seconds, follow_redirects=True) as client:
                    with client.stream("GET", remote_url) as response:
                        if response.status_code == 404:
                            # Try alternative revision R1 or raise not found
                            raise FileNotFoundError(f"NASA granule not found at upstream: {remote_url}")
                        response.raise_for_status()

                        with open(temp_path, "wb") as f:
                            for chunk in response.iter_bytes(chunk_size=65536):
                                f.write(chunk)
                                sha256.update(chunk)

                # Atomic rename
                temp_path.rename(final_path)
                logger.info(f"Successfully downloaded {filename} ({final_path.stat().st_size} bytes, SHA256: {sha256.hexdigest()[:12]}...)")
                return final_path

            except Exception as e:
                last_error = e
                if temp_path.exists():
                    temp_path.unlink()
                logger.warning(f"Download attempt {attempt}/{self.max_retries} failed for {remote_url}: {e}")
                if attempt < self.max_retries:
                    time.sleep(2 ** attempt)

        raise RuntimeError(f"Failed to retrieve NASA GEOS-CF granule from {remote_url} after {self.max_retries} attempts: {last_error}")
