from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...api.schemas.dataset_metadata_schema import LocationItem
from ...repositories.location_repository import LocationRepository
from ...models.entities import PRESET_LOCATIONS

router = APIRouter(prefix="/locations", tags=["Locations"])


@router.get("", response_model=List[LocationItem], summary="List Geographic Locations")
def list_locations(db: Session = Depends(get_db)):
    """Returns all preset geographic locations available for spatial jukebox playlists."""
    db_locs = LocationRepository.list_locations(db)
    if not db_locs:
        return [
            LocationItem(
                id=loc["id"],
                name=loc["name"],
                lat=loc["latitude"],
                lon=loc["longitude"],
                region=loc["region"],
                isPreset=loc["is_preset"],
            )
            for loc in PRESET_LOCATIONS
        ]

    return [
        LocationItem(
            id=loc.id,
            name=loc.name,
            lat=loc.latitude,
            lon=loc.longitude,
            region=loc.region,
            isPreset=loc.is_preset,
        )
        for loc in db_locs
    ]
