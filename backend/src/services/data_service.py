from pathlib import Path
from typing import Optional, List, Dict
from ..api.schemas.observation_schema import DatasetSchema, ObservationSchema, DatasetRangeSchema
from ..processors.nasa_aod_processor import NasaAodProcessor
from ..processors.nasa_svs_processor import NasaSvsProcessor
from ..utils.logger import logger


class DataService:
    """
    Backend service managing scientific datasets, queries, and range calculations.
    Supports both column Aerosol Optical Depth (AOD) and NASA SVS 5533 GEOS-CF Air Quality.
    """

    def __init__(self, data_dir: Optional[Path] = None):
        if data_dir is None:
            data_dir = Path(__file__).resolve().parent.parent / "data" / "processed"
        self.data_dir = data_dir
        self.aod_path = self.data_dir / "aod_nasa_processed.json"
        self.svs_path = self.data_dir / "svs5533_geos_cf_processed.json"

        self._datasets: Dict[str, Optional[DatasetSchema]] = {
            "aod": None,
            "air_quality": None,
        }
        self.reload()

    def reload(self) -> None:
        """Loads and caches both active datasets into memory."""
        # Load AOD dataset
        self._datasets["aod"] = NasaAodProcessor.load_processed_dataset(self.aod_path)
        if self._datasets["aod"]:
            logger.info(f"Loaded AOD dataset '{self._datasets['aod'].id}' with {len(self._datasets['aod'].observations)} observations.")
        else:
            logger.warning(f"Could not load AOD dataset from {self.aod_path}.")

        # Load SVS 5533 Air Quality dataset (generate if missing)
        if not self.svs_path.exists():
            logger.info("Generating SVS 5533 dataset on initial startup...")
            generated = NasaSvsProcessor.generate_verified_svs_dataset()
            NasaSvsProcessor.save_processed_dataset(generated, self.svs_path)

        self._datasets["air_quality"] = NasaSvsProcessor.load_processed_dataset(self.svs_path)
        if self._datasets["air_quality"]:
            logger.info(f"Loaded SVS 5533 dataset '{self._datasets['air_quality'].id}' with {len(self._datasets['air_quality'].observations)} observations.")
        else:
            logger.warning(f"Could not load SVS dataset from {self.svs_path}.")

    def get_dataset(self, key: str = "air_quality") -> Optional[DatasetSchema]:
        """Returns the full active dataset by key ('air_quality' or 'aod')."""
        return self._datasets.get(key)

    def get_observations(self, key: str = "air_quality") -> List[ObservationSchema]:
        """Returns chronological list of observations for the given dataset."""
        ds = self._datasets.get(key)
        if not ds:
            return []
        return sorted(ds.observations, key=lambda o: o.timestamp)

    def get_observation_by_id(self, obs_id: str, key: str = "air_quality") -> Optional[ObservationSchema]:
        """Finds a single observation by its unique ID across datasets."""
        # Search specified dataset first
        ds = self._datasets.get(key)
        if ds:
            for obs in ds.observations:
                if obs.id == obs_id:
                    return obs

        # Fallback search across all datasets
        for other_key, other_ds in self._datasets.items():
            if other_ds and other_key != key:
                for obs in other_ds.observations:
                    if obs.id == obs_id:
                        return obs
        return None

    def get_range(self, key: str = "air_quality") -> DatasetRangeSchema:
        """Calculates min and max values across observations for sonification normalization."""
        ds = self._datasets.get(key)
        if not ds or not ds.observations:
            return DatasetRangeSchema(min=0.0, max=1.0)
        values = [o.value for o in ds.observations]
        return DatasetRangeSchema(min=min(values), max=max(values))


backend_data_service = DataService()
