from typing import Optional, List
from sqlalchemy.orm import Session
from ..models.entities import Location


class LocationRepository:
    """Repository handling named preset locations and user locations."""

    @staticmethod
    def list_locations(db: Session, presets_only: bool = False) -> List[Location]:
        query = db.query(Location)
        if presets_only:
            query = query.filter(Location.is_preset.is_(True))
        return query.order_by(Location.name).all()

    @staticmethod
    def get_location(db: Session, location_id: str) -> Optional[Location]:
        return db.query(Location).filter(Location.id == location_id).first()

    @staticmethod
    def upsert_location(
        db: Session,
        location_id: str,
        name: str,
        lat: float,
        lon: float,
        region: str,
        is_preset: bool = False,
    ) -> Location:
        loc = db.query(Location).filter(Location.id == location_id).first()
        if not loc:
            loc = Location(
                id=location_id,
                name=name,
                latitude=lat,
                longitude=lon,
                region=region,
                is_preset=is_preset,
            )
            db.add(loc)
        else:
            loc.name = name
            loc.latitude = lat
            loc.longitude = lon
            loc.region = region
            loc.is_preset = is_preset
        db.commit()
        db.refresh(loc)
        return loc
