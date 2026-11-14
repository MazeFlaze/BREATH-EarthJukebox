from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple


class BaseNasaProvider(ABC):
    """
    Abstract Base Class for NASA Earth Observation Providers.
    Allows pluggable adapters for GMAO GEOS-CF, Earthdata CMR, GIBS, etc.
    """

    @abstractmethod
    def get_source_metadata(self) -> Dict[str, Any]:
        """Returns provider, product version, data type, and provenance metadata."""
        pass

    @abstractmethod
    def list_variables(self) -> Dict[str, Dict[str, Any]]:
        """Returns catalog of supported scientific variables, physical units, and descriptions."""
        pass

    @abstractmethod
    def list_available_times(self) -> List[str]:
        """Returns available UTC timestamps in ISO 8601 format."""
        pass

    @abstractmethod
    def fetch_granule(self, timestamp: str, target_dir: Optional[Path] = None) -> Path:
        """
        Retrieves authentic NetCDF granule for the given timestamp.
        Writes to target directory with integrity verification and returns local path.
        """
        pass
