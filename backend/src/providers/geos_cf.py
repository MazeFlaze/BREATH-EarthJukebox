import hashlib
import time
from datetime import datetime, timedelta, timezone
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
    DEFAULT_OPENDAP_URL = "https://opendap.nccs.nasa.gov/dods/gmao/geos-cf/v2/ana"
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
        opendap_url: Optional[str] = None,
        product: Optional[str] = None,
        raw_storage_dir: Optional[Path] = None,
        timeout_seconds: int = 60,
        max_retries: int = 3,
        preserve_raw: bool = False,
    ):
        self.portal_url = (portal_url or self.DEFAULT_PORTAL_URL).rstrip("/")
        self.opendap_url = (opendap_url or self.DEFAULT_OPENDAP_URL).rstrip("/")
        self.product = product or self.DEFAULT_PRODUCT
        if raw_storage_dir is None:
            from ..core.config import settings
            raw_storage_dir = settings.DATA_STORAGE_ROOT
        self.raw_storage_dir = raw_storage_dir
        self.raw_storage_dir.mkdir(parents=True, exist_ok=True)
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.preserve_raw = preserve_raw

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

    def build_opendap_url(self, dt: datetime) -> str:
        """
        Constructs OPeNDAP DODS URL for remote subsetting without full granule download.
        Example: .../dods/gmao/geos-cf/v2/ana/Y2026/M11/D13/GEOS.cf.ana.aqc_tavg_1hr_glo_L1440x721_slv.20261113_0130z.R0
        """
        year_str = dt.strftime("%Y")
        month_str = dt.strftime("%m")
        day_str = dt.strftime("%d")
        base_name = self.format_granule_filename(dt).replace(".nc4", "")
        return f"{self.opendap_url}/Y{year_str}/M{month_str}/D{day_str}/{base_name}"

    def extract_point_opendap(
        self,
        dt: datetime,
        lat: float,
        lon: float,
        variable: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Performs remote slice for a single observation point via NASA OPeNDAP DODS.
        Returns point dictionary if successful, or None on network/connection failure.
        """
        from ..core.config import settings
        if not getattr(settings, "ENABLE_REMOTE_OPENDAP", False):
            return None

        import xarray as xr
        from ..processors.netcdf_processor import NetCDFProcessor

        opendap_url = self.build_opendap_url(dt)
        try:
            logger.info(f"Attempting remote OPeNDAP slice from: {opendap_url}")
            with xr.open_dataset(opendap_url) as ds:
                pt_data = NetCDFProcessor.extract_point_value(ds, variable, lat, lon, timestamp=dt)
                return pt_data
        except Exception as e:
            logger.info(f"OPeNDAP slice unavailable ({e}), will use standard file pipeline.")
            return None

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

    def discover_latest_available_date(
        self,
        max_lookback_days: int = 7,
        reference_date: Optional[datetime] = None,
    ) -> Optional[str]:
        """
        Probes NASA NCCS DataShare backward from today (UTC) to locate the newest
        published UTC date (YYYY-MM-DD) containing an hourly GEOS-CF v2 granule.
        """
        anchor = (reference_date or datetime.now(timezone.utc)).astimezone(timezone.utc)
        timeout = min(self.timeout_seconds, 10)
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            for offset in range(max_lookback_days + 1):
                candidate_day = anchor - timedelta(days=offset)
                for probe_hour in (0, 3):
                    probe_dt = candidate_day.replace(hour=probe_hour, minute=30, second=0, microsecond=0)
                    url = self.build_remote_url(probe_dt)
                    try:
                        resp = client.head(url)
                        if resp.status_code == 200:
                            date_str = probe_dt.strftime("%Y-%m-%d")
                            logger.info(f"Discovered latest remote NASA GEOS-CF date: {date_str} ({url})")
                            return date_str
                    except Exception as exc:
                        logger.debug(f"HEAD probe failed for {url}: {exc}")
        return None

    def fetch_granule(
        self,
        timestamp: str,
        target_dir: Optional[Path] = None,
        auto_cleanup: bool = True,
    ) -> Path:
        """
        Downloads authentic NetCDF granule from NASA NCCS DataShare if not already present.
        Validates SHA256, uses atomic write (.tmp -> .nc4), and retries with backoff.
        """
        dt = pd.to_datetime(timestamp, utc=True).to_pydatetime()
        filename = self.format_granule_filename(dt)
        dest_dir = target_dir or self.raw_storage_dir
        dest_dir.mkdir(parents=True, exist_ok=True)
        final_path = dest_dir / filename

        remote_url = self.build_remote_url(dt)
        from .geos_cf_provenance import checksum_file, inspect_asset, valid_receipt, write_receipt
        if final_path.exists():
            try:
                info = inspect_asset(final_path)
                if valid_receipt(final_path, checksum_file(final_path), info["timestamp_utc"], remote_url):
                    logger.info(f"Using validated cached GEOS-CF file: {final_path}")
                    return final_path
            except (ValueError, OSError):
                pass
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
                        total = int(response.headers.get("content-length", 0))
                        received = 0
                        last_report = 0.0

                        with open(temp_path, "wb") as f:
                            for chunk in response.iter_bytes(chunk_size=65536):
                                f.write(chunk)
                                sha256.update(chunk)
                                received += len(chunk)
                                now = time.monotonic()
                                if now - last_report >= 1:
                                    label = f"{received * 100 / total:.1f}%" if total else "size unknown"
                                    print(f"  {filename}: {received / 1048576:.2f} MiB ({label})", flush=True)
                                    last_report = now

                # Atomic rename
                # Validate before replacing an existing cache entry. inspect_asset needs the real filename.
                validation_dir = dest_dir / ".validation"
                validation_dir.mkdir(exist_ok=True)
                candidate = validation_dir / filename
                temp_path.replace(candidate)
                try:
                    write_receipt(candidate, remote_url)
                    candidate.replace(final_path)
                    candidate.with_name(candidate.name + ".source.json").replace(final_path.with_name(filename + ".source.json"))
                finally:
                    candidate.unlink(missing_ok=True)
                    candidate.with_name(candidate.name + ".source.json").unlink(missing_ok=True)
                logger.info(f"Successfully downloaded {filename} ({final_path.stat().st_size} bytes, SHA256: {sha256.hexdigest()[:12]}...)")
                if auto_cleanup and not self.preserve_raw:
                    self.cleanup_old_granules()
                return final_path

            except Exception as e:
                last_error = e
                if temp_path.exists():
                    temp_path.unlink()
                logger.warning(f"Download attempt {attempt}/{self.max_retries} failed for {remote_url}: {e}")
                if attempt < self.max_retries:
                    time.sleep(2 ** attempt)

        raise RuntimeError(f"Failed to retrieve NASA GEOS-CF granule from {remote_url} after {self.max_retries} attempts: {last_error}")

    def cleanup_old_granules(self, max_files: Optional[int] = None) -> List[str]:
        """
        LRU Disk Retention Policy:
        Removes oldest NetCDF files when total files exceed max_files limit.
        Returns list of deleted file names.
        """
        if self.preserve_raw:
            return []
        try:
            from ..core.config import settings
            limit = max_files if max_files is not None else settings.MAX_RAW_FILES_TO_KEEP
        except Exception:
            limit = max_files or 10
        if limit < 1:
            raise ValueError("Retention limit must be positive; use preserve_raw to disable eviction")

        files = sorted(
            [f for f in self.raw_storage_dir.glob("GEOS.cf.ana.*.nc4") if f.is_file()],
            key=lambda p: p.stat().st_mtime,
        )

        evicted: List[str] = []
        if len(files) > limit:
            to_remove = files[:-limit]
            for f in to_remove:
                try:
                    logger.info(f"LRU Retention: evicting oldest raw NetCDF granule {f.name}")
                    f.unlink()
                    evicted.append(f.name)
                except Exception as e:
                    logger.warning(f"Could not delete old granule {f.name}: {e}")

        return evicted
